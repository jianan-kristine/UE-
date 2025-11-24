// server.ts — Web 服务器 + API
import "jsr:@std/dotenv/load";
import { buildCompetitorResearchTask } from "./prompts/ideaCompetitorPrompt.ts";
import { GCSStorageService } from "./storage/gcsStorage.ts";
import type { StoredReport, ReportListItem } from "./types/reports.ts";
import type { ToolApprovalRequest, PendingApproval } from "./types/approval.ts";

import {
  createZypherContext,
  startWorkflow,
  type ZypherContext,
  type Task,
  type WorkflowConfig,
  ZypherAgent,
  OpenAIModelProvider,
  CheckpointManager,
  MaxTokensInterceptor,
} from "@corespeed/zypher";
import { eachValueFrom } from "rxjs-for-await";

// 自定义错误类型：需要审批
class PendingApprovalError extends Error {
  constructor(
    public approvalId: string,
    public toolName: string,
    public toolArgs: any,
    public sessionId: string,
    public checkpointId?: string
  ) {
    super("PENDING_TOOL_APPROVAL");
    this.name = "PendingApprovalError";
  }
}

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// 配置：Loop Interceptor 参数
const CONFIG = {
  MAX_TOOL_CALLS: parseInt(Deno.env.get("MAX_TOOL_CALLS") || "5"),
  MAX_ITERATIONS: parseInt(Deno.env.get("MAX_ITERATIONS") || "20"),
  TIMEOUT_MS: parseInt(Deno.env.get("ANALYSIS_TIMEOUT_MS") || "120000"), // 2分钟
};

// 简单的 model 映射：前端的 model 值 → 实际调用的模型名
function resolveModelName(model: string | undefined): string {
  switch (model) {
    case "deepseek-accurate":
      return "deepseek-reasoner";
    case "deepseek-fast":
    default:
      return "deepseek-chat";
  }
}

// 初始化 Agent（复用逻辑）
async function initAgent() {
  const zypherContext = await createZypherContext(Deno.cwd());

  // 使用 DeepSeek（OpenAI 兼容 API）
  const provider = new OpenAIModelProvider({
    apiKey: getEnv("DEEPSEEK_API_KEY"),
    baseUrl: "https://api.deepseek.com",
  });

  const agent = new ZypherAgent(zypherContext, provider);

  // 初始化 CheckpointManager
  const checkpointManager = new CheckpointManager(zypherContext);

  // 审批管理
  const pendingApprovals = new Map<string, PendingApproval>();
  const approvedTools = new Map<string, { approved: boolean; timestamp: Date }>();

  // 注册 Firecrawl MCP（错误会在运行时被忽略）
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (firecrawlKey) {
    console.log("Registering Firecrawl MCP...");
    try {
      await agent.mcp.registerServer({
        id: "firecrawl",
        type: "command",
        command: {
          command: "npx",
          args: ["-y", "firecrawl-mcp"],
          env: { FIRECRAWL_API_KEY: firecrawlKey },
        },
      });
    } catch (e) {
      console.warn("Failed to register Firecrawl MCP:", (e as Error).message);
    }
  }

  // 某些版本 ZypherAgent 有 init()
  if ("init" in agent && typeof (agent as any).init === "function") {
    await (agent as any).init();
  }

  let maxTokensInterceptor: MaxTokensInterceptor | null = null;

  // Tool Patch + MaxTokensInterceptor + Approval Interceptor
  if ("loopInterceptors" in agent && agent.loopInterceptors) {
    // ✅ Firecrawl 参数修正拦截器
    agent.loopInterceptors.register({
      name: "fix-firecrawl-search",
      async onToolCall(toolCall: any) {
        if (toolCall.name === "firecrawl_search" && toolCall.args) {
          // 修正 sources 参数：["web"] → [{ type: "web" }]
          if (
            Array.isArray(toolCall.args.sources) &&
            typeof toolCall.args.sources[0] === "string"
          ) {
            console.log(
              `🔧 Fixing firecrawl_search sources parameter: ${JSON.stringify(
                toolCall.args.sources,
              )} → [{ type: "web" }]`,
            );
            toolCall.args.sources = [{ type: "web" }];
          }
        }
        return toolCall;
      },
    });
    console.log("✅ Registered Tool Patch Interceptor for Firecrawl");

    // ✅ MaxTokens 自动续写拦截器（默认开启，具体每次请求可通过 enableAutoContinue 控制）
    try {
      maxTokensInterceptor = new MaxTokensInterceptor({
        enabled: true,
        maxContinuations: 3,
      });
      agent.loopInterceptors.register(maxTokensInterceptor);
      console.log("✅ Registered MaxTokensInterceptor");
    } catch (e) {
      console.warn("⚠️  Failed to register MaxTokensInterceptor:", e);
      maxTokensInterceptor = null;
    }
  }

  return { agent, checkpointManager, maxTokensInterceptor, pendingApprovals, approvedTools };
}

// 运行分析任务
async function runAnalysis(
  agent: ZypherAgent,
  checkpointManager: CheckpointManager,
  ideaText: string,
  mode: "quick" | "deep" = "quick",
  language: string = "en",
  sessionId?: string,
  options?: {
    allowWebTools?: boolean;
    persona?: string;
    model?: string;
    previousProgress?: number;
    requireToolApproval?: boolean; // 新增：是否需要工具审批
  },
  pendingApprovals?: Map<string, PendingApproval>,
  approvedTools?: Map<string, { approved: boolean; timestamp: Date }>,
): Promise<{ 
  report: string; 
  checkpointId?: string; 
  interrupted: boolean; 
  progress?: number;
  needsApproval?: boolean;
  approvalId?: string;
  toolName?: string;
  toolArgs?: any;
}> {
  const persona = options?.persona;
  const model = options?.model;
  const allowWebTools = options?.allowWebTools ?? true;
  const previousProgress = options?.previousProgress ?? 0;
  const requireToolApproval = options?.requireToolApproval ?? false;

  const task = buildCompetitorResearchTask(ideaText, language, mode, persona);

  // 根据模式设置不同的限制
  const isQuickMode = mode === "quick";
  let maxToolCalls = isQuickMode ? CONFIG.MAX_TOOL_CALLS : 999; // 深度模式几乎不限制
  const maxIterations = isQuickMode ? CONFIG.MAX_ITERATIONS : 50;
  const timeout = isQuickMode ? CONFIG.TIMEOUT_MS : 300000; // 深度模式5分钟

  if (!allowWebTools) {
    maxToolCalls = 0;
  }

  const modelName = resolveModelName(model);

  console.log(
    `📊 Mode: ${mode.toUpperCase()} (max_tools=${maxToolCalls}, max_iter=${maxIterations}, timeout=${timeout}ms, model=${modelName}, persona=${persona || "default"})`,
  );

  // 🔍 DEBUG: 列出可用工具（可选，某些版本不支持）
  try {
    if (typeof agent.mcp.listTools === 'function') {
      const availableTools = await agent.mcp.listTools();
      console.log(`\n🔧 Available tools (${availableTools.length}):`);
      availableTools.forEach((tool: any) => {
        console.log(`   - ${tool.name}`);
      });
      console.log();
    } else {
      console.log(`ℹ️  agent.mcp.listTools not available (older Zypher version)`);
    }
  } catch (e) {
    console.warn(`⚠️  Could not list tools:`, (e as Error).message);
  }
  
  // 🔍 DEBUG: 打印审批配置
  console.log(`\n🔒 Tool Approval Configuration:`);
  console.log(`   - requireToolApproval: ${requireToolApproval}`);
  console.log(`   - sessionId: ${sessionId}`);
  console.log(`   - pendingApprovals: ${pendingApprovals ? 'initialized' : 'null'}`);
  console.log(`   - approvedTools: ${approvedTools ? 'initialized' : 'null'}`);
  console.log();

  // Loop Interceptor: 限制工具使用次数
  let toolCallCount = 0;
  let hasWarned = false;
  const startTime = Date.now();
  let lastCheckpointId: string | undefined;
  let interrupted = false;

  // 捕获 TaskConcurrencyError 以防止服务器崩溃
  let event$: AsyncIterable<any>;
  try {
    event$ = agent.runTask(task, modelName, undefined, {
      maxIterations,
    });
  } catch (error) {
    // 捕获同步抛出的 TaskConcurrencyError
    if (error instanceof Error && error.name === 'TaskConcurrencyError') {
      console.error('❌ TaskConcurrencyError: Another task is already running on this agent');
      console.error('   This usually happens when:');
      console.error('   1. A previous task did not complete properly');
      console.error('   2. Multiple concurrent requests hit the same agent');
      throw new Error('服务器繁忙，请稍后重试。(Another analysis is already in progress)');
    }
    throw error;
  }

  let finalOutput = "";

  try {
    for await (const event of eachValueFrom(event$)) {
      // 超时检查
      const elapsed = Date.now() - startTime;
      if (elapsed > timeout) {
        console.warn(
          `⏱️  Analysis timeout (${timeout}ms). Saving checkpoint...`,
        );
        interrupted = true;
        break;
      }

      // 拦截工具调用
      if (event.type === "tool_use") {
        toolCallCount++;

        // Zypher 这边工具名在 toolName 上
        const toolName = (event as any).toolName;

        // 尝试常见的几种字段名，把真正的参数抓出来
        const toolArgs =
          (event as any).toolArgs ??
          (event as any).arguments ??
          (event as any).args ??
          (event as any).input ??
          null;

        console.log(
          `🔧 Tool call #${toolCallCount}: ${toolName || "unknown"}`,
        );

        // 临时完整 dump 一次，确认实际结构（确认完可以注释掉）
        try {
          console.log("🔍 RAW TOOL EVENT:", JSON.stringify(event, null, 2));
        } catch {
          console.log("🔍 RAW TOOL EVENT: <unserializable>");
        }

        if (toolArgs) {
          console.log(
            `   Args keys: ${Object.keys(toolArgs).join(", ")}`
          );
        } else {
          console.log("   Args: <none / not found>");
        }

        // ✅ Firecrawl 审批拦截
        if (
          requireToolApproval &&
          toolName &&
          toolName.startsWith("firecrawl_") &&
          sessionId &&
          pendingApprovals &&
          approvedTools
        ) {
          console.log("🔔 ============================================");
          console.log("🔔 TOOL APPROVAL CHECK");
          console.log("🔔 ============================================");
          console.log(`   Tool: ${toolName}`);
          console.log(`   Session: ${sessionId}`);
          console.log(
            "   Args:",
            toolArgs ? JSON.stringify(toolArgs, null, 2) : "<none>",
          );

          const approvalKey = `${sessionId}:${toolName}`;
          const existingApproval = approvedTools.get(approvalKey);

          console.log(`   Approval key: ${approvalKey}`);
          console.log("   Existing approval:", existingApproval);

          if (!existingApproval) {
            // 第一次调用，需要审批

            // 1) 先保存 checkpoint
            let savedCheckpointId: string | undefined;
            try {
              const checkpointName = `approval_${sessionId}_${Date.now()}`;
              console.log(
                `💾 Saving checkpoint for approval: ${checkpointName}`,
              );
              const checkpoint = await checkpointManager.createCheckpoint(
                checkpointName,
              );
              savedCheckpointId = checkpoint.id;
              console.log(`✅ Checkpoint saved: ${savedCheckpointId}`);
            } catch (e) {
              console.error("❌ Failed to save checkpoint:", e);
            }

            // 2) 创建审批 ID 和记录
            const approvalId =
              `approval_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

            pendingApprovals.set(approvalId, {
              approvalId,
              sessionId,
              toolName,
              toolArgs,
              timestamp: new Date(),
            });

            console.log("🔔 ============================================");
            console.log(`🔔 REQUESTING APPROVAL: ${approvalId}`);
            console.log("🔔 ============================================");
            console.log(
              `   CheckpointId: ${savedCheckpointId || "FAILED TO SAVE"}`,
            );
            console.log(
              "   This will trigger approval modal in frontend",
            );
            console.log("   Throwing PendingApprovalError...");

            // 3) 抛出审批错误（包含 checkpointId）
            throw new PendingApprovalError(
              approvalId,
              toolName,
              toolArgs,
              sessionId,
              savedCheckpointId,
            );
          } else if (existingApproval.approved === false) {
            // 已拒绝，跳过此工具调用
            console.log(
              `❌ Tool call rejected by user, skipping: ${toolName}`,
            );
            continue;
          }
          // approved === true，继续执行
          console.log(
            `✅ Tool call approved by user, executing: ${toolName}`,
          );
          console.log("🔔 ============================================");
        }

        if (toolCallCount > maxToolCalls) {
          if (!hasWarned) {
            console.warn(
              `⚠️  Tool call limit reached (${maxToolCalls}). Saving checkpoint...`,
            );
            hasWarned = true;
            interrupted = true;
          }
          continue;
        }
      }

      // 处理工具错误
      if (event.type === "error") {
        console.warn("❌ Tool error:", event.error);

        // 检查是否是 Firecrawl 工具参数错误，且需要审批
        const errorMsg = event.error?.message || String(event.error || "");
        const isFirecrawlError = errorMsg.includes("firecrawl_search") ||
          errorMsg.includes("firecrawl_scrape");

        if (
          requireToolApproval && isFirecrawlError && sessionId &&
          pendingApprovals && approvedTools
        ) {
          console.log("🔔 ============================================");
          console.log("🔔 FIRECRAWL TOOL ERROR - CHECKING APPROVAL");
          console.log("🔔 ============================================");
          console.log(`   Error: ${errorMsg}`);
          console.log(`   Session: ${sessionId}`);

          // Extract tool name from error if possible
          const toolName = errorMsg.includes("firecrawl_search")
            ? "firecrawl_search"
            : "firecrawl_scrape";
          const approvalKey = `${sessionId}:${toolName}`;
          const existingApproval = approvedTools.get(approvalKey);

          console.log(`   Tool: ${toolName}`);
          console.log(`   Approval key: ${approvalKey}`);
          console.log("   Existing approval:", existingApproval);

          if (!existingApproval) {
            // 第一次调用，需要审批
            const approvalId =
              `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            pendingApprovals.set(approvalId, {
              approvalId,
              sessionId,
              toolName,
              toolArgs: {
                note: "Tool parameters will be fixed after approval",
              },
              timestamp: new Date(),
            });

            console.log("🔔 ============================================");
            console.log(`🔔 REQUESTING APPROVAL: ${approvalId}`);
            console.log("🔔 ============================================");
            console.log(
              "   This will trigger approval modal in frontend",
            );
            console.log("   Throwing PendingApprovalError...");

            // 抛出审批错误（错误情况下没有 checkpoint）
            throw new PendingApprovalError(
              approvalId,
              toolName,
              { note: "Tool will be called with corrected parameters" },
              sessionId,
              undefined, // 错误情况下不保存 checkpoint
            );
          }
        }

        // 否则忽略错误并继续
        continue;
      }

      if (event.type === "message" && event.message?.role === "assistant") {
        for (const c of event.message.content) {
          if (c.type === "text") {
            finalOutput += c.text;
          }
        }
      }
    }
  } catch (error) {
    console.error("Analysis interrupted by error:", error);

    // ✅ 检查是否是 TaskConcurrencyError（异步版本）
    if (error instanceof Error && error.name === 'TaskConcurrencyError') {
      console.error('❌ TaskConcurrencyError during task execution');
      console.error('   The agent is already processing another task');
      throw new Error('服务器繁忙，请稍后重试。(Another analysis is already in progress)');
    }

    // ✅ 检查是否是审批错误
    if (error instanceof PendingApprovalError) {
      console.log(
        `🔔 Analysis paused for approval: ${error.approvalId}`,
      );

      // 使用错误中已经保存的 checkpointId
      const savedCheckpointId = error.checkpointId;
      if (savedCheckpointId) {
        console.log(`✅ Using checkpoint from error: ${savedCheckpointId}`);
      } else {
        console.warn(
          "⚠️  No checkpoint in error, trying to save one now...",
        );
        try {
          const checkpointName =
            `approval_fallback_${error.sessionId}_${Date.now()}`;
          const checkpoint = await checkpointManager.createCheckpoint(
            checkpointName,
          );
          lastCheckpointId = checkpoint.id;
          console.log(`✅ Fallback checkpoint saved: ${lastCheckpointId}`);
        } catch (e) {
          console.error("❌ Failed to save fallback checkpoint:", e);
        }
      }

      // ✅ 构建并验证审批响应
      const approvalResponse = {
        report: finalOutput,
        checkpointId: savedCheckpointId || lastCheckpointId,
        interrupted: true,
        progress: Math.round((Date.now() - startTime) / timeout * 100),
        needsApproval: true,
        approvalId: error.approvalId,
        toolName: error.toolName,
        toolArgs: error.toolArgs,
      };

      // 验证关键字段
      console.log("🔍 ============================================");
      console.log("🔍 VALIDATING APPROVAL RESPONSE");
      console.log("🔍 ============================================");

      let validationPassed = true;

      if (!approvalResponse.needsApproval) {
        console.error(
          "❌ VALIDATION FAILED: needsApproval is false or missing!",
        );
        validationPassed = false;
      } else {
        console.log("✅ needsApproval: true");
      }

      if (!approvalResponse.approvalId) {
        console.error(
          "❌ VALIDATION FAILED: approvalId is missing!",
        );
        validationPassed = false;
      } else {
        console.log(`✅ approvalId: ${approvalResponse.approvalId}`);
      }

      if (!approvalResponse.toolName) {
        console.error(
          "❌ VALIDATION FAILED: toolName is missing!",
        );
        validationPassed = false;
      } else {
        console.log(`✅ toolName: ${approvalResponse.toolName}`);
      }

      if (!approvalResponse.toolArgs) {
        console.warn("⚠️  WARNING: toolArgs is missing");
      } else {
        console.log(
          `✅ toolArgs: ${JSON.stringify(approvalResponse.toolArgs)}`,
        );
      }

      if (!approvalResponse.checkpointId) {
        console.warn(
          "⚠️  WARNING: checkpointId is missing - resume may not work!",
        );
      } else {
        console.log(
          `✅ checkpointId: ${approvalResponse.checkpointId}`,
        );
      }

      console.log(`   progress: ${approvalResponse.progress}%`);
      console.log(`   interrupted: ${approvalResponse.interrupted}`);

      if (validationPassed) {
        console.log("✅ ============================================");
        console.log(
          "✅ VALIDATION PASSED - Returning approval response",
        );
        console.log("✅ ============================================");
      } else {
        console.error("❌ ============================================");
        console.error("❌ VALIDATION FAILED - But returning anyway");
        console.error("❌ ============================================");
      }

      // 返回需要审批的信息
      return approvalResponse;
    }

    interrupted = true;
  }

  // 如果分析被中断，自动保存检查点
  if (interrupted) {
    try {
      const checkpointName =
        `auto_${sessionId || Date.now()}_${ideaText.substring(0, 30)}`;
      console.log(`💾 Auto-saving checkpoint: ${checkpointName}`);
      const checkpoint = await checkpointManager.createCheckpoint(
        checkpointName,
      );
      lastCheckpointId = checkpoint.id;
      console.log("✅ Checkpoint saved successfully!");
      console.log(`   - Checkpoint ID: ${lastCheckpointId}`);
      console.log(`   - Checkpoint Name: ${checkpointName}`);
      console.log(`   - Session ID: ${sessionId || "none"}`);
    } catch (e) {
      console.error("❌ Failed to save checkpoint:", e);
    }
  } else {
    console.log(`ℹ️  Analysis completed normally, no checkpoint needed`);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  
  // 🔥 改用工具调用次数计算真实进度（而非时间估算）
  let progressPct: number;
  if (interrupted) {
    if (maxToolCalls > 0) {
      // 基于工具调用进度：已调用次数 / 最大次数
      const toolProgress = Math.round((toolCallCount / maxToolCalls) * 100);
      progressPct = Math.min(95, toolProgress); // 中断时最多95%
    } else {
      // 如果没有工具调用限制（deep模式 + 不允许Web工具），用时间估算
      const elapsedTotal = Date.now() - startTime;
      const timeProgress = Math.round((elapsedTotal / timeout) * 100);
      progressPct = Math.min(95, previousProgress + timeProgress);
    }
  } else {
    progressPct = 100; // 正常完成
  }

  console.log(
    `✅ Analysis complete in ${totalTime}s. Tool calls: ${
      Math.min(toolCallCount, maxToolCalls)
    }/${maxToolCalls} | progress: ${previousProgress}% → ${progressPct}%`,
  );

  return {
    report: finalOutput,
    checkpointId: lastCheckpointId,
    interrupted,
    progress: progressPct,
  };
}

// HTTP 服务器
async function startServer() {
  const {
    agent,
    checkpointManager,
    maxTokensInterceptor,
    pendingApprovals,
    approvedTools,
  } = await initAgent();

  console.log("🚀 Server starting on http://localhost:8001");
  console.log("📋 Configuration:");
  console.log(`   - Max tool calls: ${CONFIG.MAX_TOOL_CALLS}`);
  console.log(`   - Max iterations: ${CONFIG.MAX_ITERATIONS}`);
  console.log(
    `   - Timeout: ${CONFIG.TIMEOUT_MS}ms (${
      (CONFIG.TIMEOUT_MS / 1000).toFixed(1)
    }s)`,
  );
  console.log("");

  // 任务锁：防止并发任务执行
  let isTaskRunning = false;
  const taskQueue: Array<() => Promise<void>> = [];

  // sessionId -> messages[] map to keep per-session conversation history
  const sessionMessages = new Map<string, any[]>();

  async function executeTask(task: () => Promise<void>) {
    if (isTaskRunning) {
      console.log("⏳ Task already running, queueing new task...");
      return new Promise<void>((resolve) => {
        taskQueue.push(async () => {
          await task();
          resolve();
        });
      });
    }

    isTaskRunning = true;
    try {
      await task();
    } finally {
      isTaskRunning = false;
      const nextTask = taskQueue.shift();
      if (nextTask) {
        console.log("▶️  Processing next queued task...");
        executeTask(nextTask);
      }
    }
  }

  Deno.serve({ port: 8001 }, async (req) => {
    const url = new URL(req.url);

    // 提供静态 CSS 文件
    if (url.pathname === "/styles.css") {
      try {
        const css = await Deno.readTextFile("./public/styles.css");
        return new Response(css, {
          headers: { "Content-Type": "text/css; charset=utf-8" },
        });
      } catch (e) {
        console.error("Failed to load styles.css:", e);
        return new Response("CSS file not found", { status: 404 });
      }
    }

    // 提供前端页面
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await Deno.readTextFile("./public/index.html");
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 提供可视化页面
    if (url.pathname === "/visualize.html") {
      const html = await Deno.readTextFile("./public/visualize.html");
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // ✅ Reports list page
    if (url.pathname === "/reports.html") {
      const html = await Deno.readTextFile("./public/reports.html");
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Report detail page
    if (url.pathname === "/report.html") {
      const html = await Deno.readTextFile("./public/report.html");
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Test approval page
    if (url.pathname === "/test-approval.html") {
      const html = await Deno.readTextFile("./test-approval.html");
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // API: 分析 idea / follow-up（纯文本）
    if (url.pathname === "/api/analyze" && req.method === "POST") {
      const body = await req.json();

      const ideaRaw = (body.idea ?? "").toString();
      const idea = ideaRaw.trim();
      const followUpRaw = (body.followUp ?? "").toString();
      const followUp = followUpRaw.trim();

      const mode: "quick" | "deep" = body.mode === "deep" ? "deep" : "quick";
      const language: string = body.language || "en";
      const checkpointId: string | undefined = body.checkpointId || undefined;
      const sessionId: string | undefined = body.sessionId || undefined;

      const persona: string | undefined = body.persona || undefined;
      const model: string | undefined = body.model || undefined;
      const allowWebTools: boolean =
        body.allowWebTools === false ? false : true;
      const enableAutoContinue: boolean =
        body.enableAutoContinue === false ? false : true;
      const previousProgress: number = body.previousProgress || 0;
      const requireToolApproval: boolean = body.requireToolApproval === true;

      if (!idea && !followUp) {
        return Response.json(
          { error: "Missing idea or followUp" },
          { status: 400 },
        );
      }

      const ideaText = followUp
        ? `${idea || ""}\n\n[User follow-up]\n${followUp}`.trim()
        : idea;

      console.log(`\n📊 API /api/analyze received:`);
      console.log(`   - idea: "${idea}"`);
      console.log(
        `   - followUp: "${
          followUp ? followUp.substring(0, 120) + "..." : ""
        }"`,
      );
      console.log(`   - ideaText len: ${ideaText.length}`);
      console.log(`   - mode: ${mode}`);
      console.log(`   - language: ${language}`);
      console.log(`   - persona: ${persona || "default"}`);
      console.log(`   - model: ${model || "deepseek-fast"}`);
      console.log(`   - allowWebTools: ${allowWebTools}`);
      console.log(`   - enableAutoContinue: ${enableAutoContinue}`);
      console.log(`   - requireToolApproval: ${requireToolApproval}`);
      console.log(`   - checkpointId: ${checkpointId || "null"}`);
      console.log(`   - sessionId: ${sessionId || "null"}`);
      console.log(`   - previousProgress: ${previousProgress}%\n`);

      if (maxTokensInterceptor) {
        maxTokensInterceptor.enabled = enableAutoContinue;
        console.log(
          `   - MaxTokensInterceptor.enabled = ${maxTokensInterceptor.enabled}`,
        );
      }

      type AnalysisResult = {
        report: string;
        checkpointId?: string;
        interrupted: boolean;
        progress?: number;
        needsApproval?: boolean;
        approvalId?: string;
        toolName?: string;
        toolArgs?: any;
      };
      let result: AnalysisResult | null = null;
      let taskError: unknown = null;

      await executeTask(async () => {
        // Restore per-session messages into agent before running
        try {
          if (sessionId) {
            try {
              const msgs = sessionMessages.get(sessionId);
              if (msgs && (agent as any)) {
                try {
                  (agent as any).messages = msgs;
                  console.log(
                    `🗂️ Restored ${
                      Array.isArray(msgs) ? msgs.length : "unknown"
                    } messages for session ${sessionId}`,
                  );
                } catch (e) {
                  console.warn("Failed to assign messages to agent:", e);
                }
              }
            } catch (e) {
              console.warn("Failed to restore session messages:", e);
            }
          }

          // If provided checkpointId, try to restore it
          if (checkpointId) {
            try {
              console.log(`🔄 Restoring checkpoint: ${checkpointId}`);
              await agent.applyCheckpoint(checkpointId);
              console.log(
                `✅ Checkpoint ${checkpointId} restored successfully`,
              );
            } catch (e) {
              console.warn(
                `⚠️  Failed to restore checkpoint ${checkpointId}:`,
                (e as Error).message,
              );
            }
          } else {
            console.log(`ℹ️  No checkpoint provided, starting fresh analysis`);
          }

          // Debug: print generated prompt
          const debugPrompt = buildCompetitorResearchTask(
            ideaText,
            language,
            mode,
            persona,
          );
          console.log(
            `\n🔍 Generated Prompt Preview (first 500 chars):\n${
              debugPrompt.substring(0, 500)
            }...\n`,
          );

          // 5️⃣ Run the agent workflow with the specified mode
          console.log(`🤖 Starting ${mode} analysis workflow...`);

          // Ensure we have an effective session id
          const effectiveSessionId = sessionId || Date.now().toString();

          // Call the new runAnalysis implementation
          result = await runAnalysis(
            agent,
            checkpointManager,
            ideaText,
            mode,
            language,
            effectiveSessionId,
            {
              allowWebTools,
              persona,
              model,
              previousProgress,
              requireToolApproval,
            },
            pendingApprovals,
            approvedTools,
          );

          if (!result) {
            return Response.json(
              { error: "Analysis failed to produce a result" },
              { status: 500 },
            );
          }

          // ✅ Generate reportId and save to reportsStore (for text-based analyses)
          const reportId = generateReportId();
          const storedReport: StoredReport = {
            id: reportId,
            idea: ideaText,
            mode,
            language,
            persona,
            model,
            fullReport: result.report,
            interrupted: result.interrupted || false,
            checkpointId: result.checkpointId,
            sessionId: effectiveSessionId,
            progress: result.progress || (result.interrupted ? 95 : 100),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          reportsStore.set(reportId, storedReport);
          console.log(`💾 Report saved to reportsStore (text analysis): ${reportId}`);

          return Response.json({
            reportId, // ✅ Include reportId in response
            report: result.report,
            checkpointId: result.checkpointId,
            interrupted: result.interrupted,
            progress: result.progress,
            needsApproval: result.needsApproval,
            approvalId: result.approvalId,
            toolName: result.toolName,
            toolArgs: result.toolArgs,
          });
        } catch (e) {
          taskError = e instanceof Error ? e : new Error(String(e));
          console.warn(
            `⚠️  Error occurred, but will return any checkpoint that was created`,
          );
        } finally {
          // Save agent.messages back to session store
          if (sessionId) {
            try {
              const current = (agent as any).messages;
              if (current) {
                sessionMessages.set(sessionId, current);
                console.log(
                  `💾 Saved ${
                    Array.isArray(current) ? current.length : "unknown"
                  } messages for session ${sessionId}`,
                );
              }
            } catch (e) {
              console.warn("Failed to save session messages:", e);
            }
          }
        }
      });

      if (taskError) {
        console.error("Error:", taskError);
        if (result && result.checkpointId) {
          console.log(
            `📦 Returning checkpoint despite error: ${result.checkpointId}`,
          );
          return Response.json(
            {
              error: (taskError as Error).message || "Unknown error",
              checkpointId: result.checkpointId,
              interrupted: true,
              report: result.report || "Analysis interrupted due to error",
              progress: result.progress,
            },
            { status: 500 },
          );
        }
        return Response.json(
          { error: (taskError as Error).message || "Unknown error" },
          { status: 500 },
        );
      }

      // TypeScript type guard - assert that result is the correct type
      const analysisResult: AnalysisResult = result;

      // ✅ 如果需要审批，验证并记录
      if (analysisResult.needsApproval) {
        console.log("🔍 ============================================");
        console.log("🔍 /api/analyze - APPROVAL RESPONSE VALIDATION");
        console.log("🔍 ============================================");
        console.log(`   needsApproval: ${analysisResult.needsApproval}`);
        console.log(
          `   approvalId: ${
            analysisResult.approvalId || "MISSING ❌"
          }`,
        );
        console.log(
          `   toolName: ${analysisResult.toolName || "MISSING ❌"}`,
        );
        console.log(
          `   toolArgs: ${
            analysisResult.toolArgs
              ? JSON.stringify(analysisResult.toolArgs)
              : "MISSING ⚠️"
          }`,
        );
        console.log(
          `   checkpointId: ${
            analysisResult.checkpointId || "MISSING ⚠️"
          }`,
        );
        console.log("🔍 ============================================");

        if (!analysisResult.approvalId || !analysisResult.toolName) {
          console.error("❌ CRITICAL: Missing required approval fields!");
        }
      }

      return Response.json({
        report: analysisResult.report,
        checkpointId: analysisResult.checkpointId,
        interrupted: analysisResult.interrupted,
        progress: analysisResult.progress,
        needsApproval: analysisResult.needsApproval,
        approvalId: analysisResult.approvalId,
        toolName: analysisResult.toolName,
        toolArgs: analysisResult.toolArgs,
      });
    }

    // ✅ API: 分析上传文件（与前端 /api/analyze-file 对应）
    if (url.pathname === "/api/analyze-file" && req.method === "POST") {
      const formData = await req.formData();

      const file = formData.get("file") as File | null;
      const noteRaw = (formData.get("note") ?? "").toString();
      const note = noteRaw.trim();

      const modeStr = (formData.get("mode") ?? "quick").toString();
      const mode: "quick" | "deep" = modeStr === "deep" ? "deep" : "quick";

      const language: string = (formData.get("language") ?? "en").toString();
      const persona: string | undefined = formData.get("persona")
        ?.toString() || undefined;
      const model: string | undefined = formData.get("model")?.toString() ||
        undefined;

      const allowWebTools: boolean =
        (formData.get("allowWebTools") ?? "true").toString() !== "false";
      const enableAutoContinue: boolean =
        (formData.get("enableAutoContinue") ?? "true").toString() !== "false";
      const requireToolApproval: boolean =
        (formData.get("requireToolApproval") ?? "false").toString() === "true";

      const checkpointId: string | undefined =
        formData.get("checkpointId")?.toString() || undefined;
      const sessionId: string | undefined =
        formData.get("sessionId")?.toString() || undefined;

      if (!file && !note) {
        return Response.json(
          { error: "Missing file and note" },
          { status: 400 },
        );
      }

      // 读取文件内容（简单版：按 UTF-8 解码，不区分 pdf/docx/txt）
      let fileSnippet = "";
      if (file) {
        try {
          const buf = await file.arrayBuffer();
          const decoder = new TextDecoder("utf-8");
          const fullText = decoder.decode(buf);
          fileSnippet = fullText.slice(0, 4000); // 最多取前 4000 字符防止 prompt 过长
        } catch (e) {
          console.warn(
            "⚠️  Failed to read file content, will only use meta:",
            e,
          );
        }
      }

      // 组合成一个 ideaText 丢给 runAnalysis
      let header = note || "";
      if (file) {
        const metaInfo = `Uploaded file: ${file.name} (${file.size} bytes).`;
        header = header
          ? `${header}\n\n[Attached file]\n${metaInfo}`
          : metaInfo;
      }

      const ideaText = fileSnippet
        ? `${header}\n\n[File content snippet]\n${fileSnippet}`
        : header;

      console.log(`\n📊 API /api/analyze-file received:`);
      console.log(
        `   - note: "${
          note ? note.substring(0, 120) + "..." : ""
        }"`,
      );
      console.log(
        `   - file: ${
          file ? file.name + " (" + file.size + " bytes)" : "none"
        }`,
      );
      console.log(`   - mode: ${mode}`);
      console.log(`   - language: ${language}`);
      console.log(`   - persona: ${persona || "default"}`);
      console.log(`   - model: ${model || "deepseek-fast"}`);
      console.log(`   - allowWebTools: ${allowWebTools}`);
      console.log(`   - enableAutoContinue: ${enableAutoContinue}`);
      console.log(`   - requireToolApproval: ${requireToolApproval}`);
      console.log(`   - checkpointId: ${checkpointId || "null"}`);
      console.log(`   - sessionId: ${sessionId || "null"}`);
      console.log(`   - ideaText len: ${ideaText.length}\n`);

      if (maxTokensInterceptor) {
        maxTokensInterceptor.enabled = enableAutoContinue;
        console.log(
          `   - MaxTokensInterceptor.enabled = ${maxTokensInterceptor.enabled}`,
        );
      }

      type AnalysisResult = {
        report: string;
        checkpointId?: string;
        interrupted: boolean;
        progress?: number;
        needsApproval?: boolean;
        approvalId?: string;
        toolName?: string;
        toolArgs?: any;
      };
      let result: AnalysisResult | null = null;
      let taskError: unknown = null;

      await executeTask(async () => {
        // Restore per-session messages into agent before running
        try {
          if (sessionId) {
            try {
              const msgs = sessionMessages.get(sessionId);
              if (msgs && (agent as any)) {
                try {
                  (agent as any).messages = msgs;
                  console.log(
                    `🗂️ Restored ${
                      Array.isArray(msgs) ? msgs.length : "unknown"
                    } messages for session ${sessionId}`,
                  );
                } catch (e) {
                  console.warn("Failed to assign messages to agent:", e);
                }
              }
            } catch (e) {
              console.warn("Failed to restore session messages:", e);
            }
          }

          // If provided checkpointId, try to restore it
          if (checkpointId) {
            try {
              console.log(`🔄 Restoring checkpoint: ${checkpointId}`);
              await agent.applyCheckpoint(checkpointId);
              console.log(
                `✅ Checkpoint ${checkpointId} restored successfully`,
              );
            } catch (e) {
              console.warn(
                `⚠️  Failed to restore checkpoint ${checkpointId}:`,
                (e as Error).message,
              );
            }
          } else {
            console.log(`ℹ️  No checkpoint provided, starting fresh analysis`);
          }

          const debugPrompt = buildCompetitorResearchTask(
            ideaText,
            language,
            mode,
            persona,
          );
          console.log(
            `\n🔍 Generated Prompt Preview (first 500 chars):\n${
              debugPrompt.substring(0, 500)
            }...\n`,
          );

          result = await runAnalysis(
            agent,
            checkpointManager,
            ideaText,
            mode,
            language,
            sessionId,
            {
              allowWebTools,
              persona,
              model,
              previousProgress: 0, // 文件上传暂时不支持继续分析
              requireToolApproval,
            },
            pendingApprovals,
            approvedTools,
          );
        } catch (e) {
          taskError = e instanceof Error ? e : new Error(String(e));
          console.warn(
            `⚠️  Error occurred, but will return any checkpoint that was created`,
          );
        } finally {
          // Save agent.messages back to session store
          if (sessionId) {
            try {
              const current = (agent as any).messages;
              if (current) {
                sessionMessages.set(sessionId, current);
                console.log(
                  `💾 Saved ${
                    Array.isArray(current) ? current.length : "unknown"
                  } messages for session ${sessionId}`,
                );
              }
            } catch (e) {
              console.warn("Failed to save session messages:", e);
            }
          }
        }
      });

      // ✅ 生成报告 ID 和保存报告
      const reportId = generateReportId();
      let fileId: string | undefined;
      let uploadedFileName: string | undefined;
      let uploadedFileSize: number | undefined;
      let uploadedFileType: string | undefined;

      // 上传文件到 GCS（如果配置了存储服务）
      if (file && storageService) {
        try {
          const fileKey = `uploads/${reportId}/${file.name}`;
          const fileBuffer = await file.arrayBuffer();
          const fileData = new Uint8Array(fileBuffer);
          await storageService.uploadFile(
            fileKey,
            fileData,
            file.type || "application/octet-stream",
          );
          fileId = fileKey;
          uploadedFileName = file.name;
          uploadedFileSize = file.size;
          uploadedFileType = file.type;
          console.log(`✅ File uploaded to GCS: ${fileKey}`);
        } catch (e) {
          console.warn("⚠️  Failed to upload file to GCS:", e);
        }
      } else if (file) {
        uploadedFileName = file.name;
        uploadedFileSize = file.size;
        uploadedFileType = file.type;
      }

      if (taskError) {
        if (result && result.checkpointId) {
          console.warn(
            `📦 Returning checkpoint despite error: ${result.checkpointId}`,
          );

          // 即使出错也保存报告
          const storedReport: StoredReport = {
            id: reportId,
            fileId,
            fileName: uploadedFileName,
            fileSize: uploadedFileSize,
            fileType: uploadedFileType,
            idea: ideaText,
            mode,
            language,
            persona: persona as any,
            model,
            fullReport: result.report ||
              "Analysis interrupted due to error",
            interrupted: true,
            checkpointId: result.checkpointId,
            sessionId,
            progress: result.progress || 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          reportsStore.set(reportId, storedReport);
          console.log(`💾 Report saved (interrupted): ${reportId}`);

          return new Response(
            JSON.stringify({
              reportId,
              fileId,
              fileName: uploadedFileName,
              error: taskError instanceof Error
                ? taskError.message
                : "Unknown error",
              checkpointId: result.checkpointId,
              interrupted: true,
              report: result.report || "Analysis interrupted due to error",
              progress: result.progress,
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        throw taskError;
      }

      // TypeScript type guard - assert that result is the correct type
      const analysisResult: AnalysisResult = result;

      // ✅ Check if approval is needed - return immediately without saving to reports
      if (analysisResult.needsApproval) {
        console.log(
          "🔔 Tool approval required for file analysis, returning approval request",
        );
        return new Response(
          JSON.stringify({
            needsApproval: true,
            approvalId: analysisResult.approvalId,
            toolName: analysisResult.toolName,
            toolArgs: analysisResult.toolArgs,
            checkpointId: analysisResult.checkpointId,
            sessionId,
            report: analysisResult.report, // Partial report so far
            progress: analysisResult.progress || 0,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // ✅ 保存成功的报告
      const storedReport: StoredReport = {
        id: reportId,
        fileId,
        fileName: uploadedFileName,
        fileSize: uploadedFileSize,
        fileType: uploadedFileType,
        idea: ideaText,
        mode,
        language,
        persona: persona as any,
        model,
        fullReport: analysisResult.report,
        interrupted: analysisResult.interrupted || false,
        checkpointId: analysisResult.checkpointId,
        sessionId,
        progress: analysisResult.progress || 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      reportsStore.set(reportId, storedReport);
      console.log(`💾 Report saved: ${reportId}`);

      return new Response(
        JSON.stringify({
          reportId,
          fileId,
          fileName: uploadedFileName,
          report: analysisResult.report,
          checkpointId: analysisResult.checkpointId,
          interrupted: analysisResult.interrupted,
          progress: analysisResult.progress || 100,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // ✅ NEW: GET /api/reports - 列出所有报告
    if (url.pathname === "/api/reports" && req.method === "GET") {
      try {
        const reports: ReportListItem[] = Array.from(reportsStore.values())
          .map((r) => ({
            id: r.id,
            fileName: r.fileName,
            idea: r.idea.substring(0, 100) +
              (r.idea.length > 100 ? "..." : ""),
            mode: r.mode,
            persona: r.persona,
            interrupted: r.interrupted,
            progress: r.progress,
            createdAt: r.createdAt,
          }))
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() -
              new Date(a.createdAt).getTime(),
          );

        return Response.json({ reports });
      } catch (error) {
        console.error("Error listing reports:", error);
        return Response.json(
          {
            error: error instanceof Error
              ? error.message
              : "Unknown error",
          },
          { status: 500 },
        );
      }
    }

    // ✅ NEW: GET /api/reports/:id - 获取单个报告详情
    if (
      url.pathname.startsWith("/api/reports/") && req.method === "GET" &&
      !url.pathname.endsWith("/reanalyze")
    ) {
      try {
        const reportId = url.pathname.split("/")[3];
        const report = reportsStore.get(reportId);

        if (!report) {
          return Response.json(
            { error: "Report not found" },
            { status: 404 },
          );
        }

        // 如果有文件，生成预签名 URL
        let fileUrl;
        if (report.fileId && storageService) {
          try {
            fileUrl = await storageService.getFileUrl(report.fileId);
          } catch (e) {
            console.warn("Failed to generate file URL:", e);
          }
        }

        return Response.json({ report, fileUrl });
      } catch (error) {
        console.error("Error fetching report:", error);
        return Response.json(
          {
            error: error instanceof Error
              ? error.message
              : "Unknown error",
          },
          { status: 500 },
        );
      }
    }

    // ✅ NEW: DELETE /api/reports/:id - 删除报告
    if (url.pathname.startsWith("/api/reports/") && req.method === "DELETE") {
      try {
        const reportId = url.pathname.split("/")[3];
        const report = reportsStore.get(reportId);

        if (!report) {
          return Response.json(
            { error: "Report not found" },
            { status: 404 },
          );
        }

        // 从 GCS 删除文件（如果存在）
        if (report.fileId && storageService) {
          try {
            await storageService.deleteFile(report.fileId);
            console.log(`✅ Deleted file from GCS: ${report.fileId}`);
          } catch (e) {
            console.warn("Failed to delete file from GCS:", e);
          }
        }

        reportsStore.delete(reportId);
        console.log(`✅ Deleted report: ${reportId}`);
        return Response.json({ success: true });
      } catch (error) {
        console.error("Error deleting report:", error);
        return Response.json(
          {
            error: error instanceof Error
              ? error.message
              : "Unknown error",
          },
          { status: 500 },
        );
      }
    }

    // ✅ NEW: POST /api/reports/:id/reanalyze - 重新分析报告
    if (
      url.pathname.startsWith("/api/reports/") &&
      url.pathname.endsWith("/reanalyze") && req.method === "POST"
    ) {
      try {
        const reportId = url.pathname.split("/")[3];
        const existingReport = reportsStore.get(reportId);

        if (!existingReport) {
          return Response.json(
            { error: "Report not found" },
            { status: 404 },
          );
        }

        const body = await req.json();
        const mode = body.mode || existingReport.mode;
        const model = body.model || existingReport.model;

        console.log(
          `🔄 Reanalyzing report ${reportId} with mode: ${mode}`,
        );

        // 创建新的报告 ID 和 session
        const newReportId = generateReportId();
        const newSessionId = Date.now().toString();

        let result: any = null;
        let taskError: unknown = null;

        await executeTask(async () => {
          try {
            result = await runAnalysis(
              agent,
              checkpointManager,
              existingReport.idea,
              mode as "quick" | "deep",
              existingReport.language,
              newSessionId,
              {
                allowWebTools: true,
                persona: existingReport.persona,
                model,
              },
            );
          } catch (e) {
            taskError = e;
          }
        });

        if (taskError || !result) {
          return Response.json(
            {
              error: taskError instanceof Error
                ? taskError.message
                : "Reanalysis failed",
            },
            { status: 500 },
          );
        }

        // 保存新报告
        const newReport: StoredReport = {
          id: newReportId,
          fileId: existingReport.fileId,
          fileName: existingReport.fileName,
          fileSize: existingReport.fileSize,
          fileType: existingReport.fileType,
          idea: existingReport.idea,
          mode: mode as "quick" | "deep",
          language: existingReport.language,
          persona: existingReport.persona,
          model,
          fullReport: result.report || "",
          interrupted: result.interrupted || false,
          checkpointId: result.checkpointId,
          sessionId: newSessionId,
          progress: result.progress || 100,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        reportsStore.set(newReportId, newReport);
        console.log(`✅ Reanalysis complete, new report: ${newReportId}`);

        return Response.json(
          { reportId: newReportId, report: newReport },
        );
      } catch (error) {
        console.error("Error reanalyzing report:", error);
        return Response.json(
          {
            error: error instanceof Error
              ? error.message
              : "Unknown error",
          },
          { status: 500 },
        );
      }
    }

    // ✅ NEW: POST /api/tool-approval - 审批工具调用
    if (url.pathname === "/api/tool-approval" && req.method === "POST") {
      try {
        const body = await req.json();
        const { approvalId, approved, reason } = body;

        if (!approvalId) {
          return Response.json(
            { error: "Missing approvalId" },
            { status: 400 },
          );
        }

        const pending = pendingApprovals.get(approvalId);
        if (!pending) {
          return Response.json(
            { error: "Approval not found or expired" },
            { status: 404 },
          );
        }

        // 记录审批结果
        const approvalKey = `${pending.sessionId}:${pending.toolName}`;
        approvedTools.set(approvalKey, {
          approved: approved === true,
          timestamp: new Date(),
        });

        console.log(
          `✅ Tool approval recorded: ${pending.toolName} → ${
            approved ? "APPROVED" : "REJECTED"
          }`,
        );

        // 清理 pending
        pendingApprovals.delete(approvalId);

        return Response.json({ success: true, approved });
      } catch (error) {
        console.error("Error processing tool approval:", error);
        return Response.json(
          {
            error: error instanceof Error
              ? error.message
              : "Unknown error",
          },
          { status: 500 },
        );
      }
    }

    // 以下是 checkpoint 相关 API（你原来的逻辑）
    if (url.pathname === "/api/checkpoints" && req.method === "GET") {
      try {
        const checkpoints = await checkpointManager.listCheckpoints();
        return Response.json({ checkpoints });
      } catch (error) {
        console.error("Error listing checkpoints:", error);
        return Response.json(
          {
            error: error instanceof Error
              ? error.message
              : "Unknown error",
          },
          { status: 500 },
        );
      }
    }

    if (url.pathname === "/api/checkpoints" && req.method === "POST") {
      try {
        const body = await req.json();
        const name = body.name?.trim();

        if (!name) {
          return Response.json(
            { error: "Missing checkpoint name" },
            { status: 400 },
          );
        }

        console.log(`💾 Creating checkpoint: ${name}`);
        const checkpoint = await checkpointManager.createCheckpoint(name);

        return Response.json({
          success: true,
          checkpoint: {
            id: checkpoint.id,
            name: checkpoint.name,
            createdAt: checkpoint.createdAt,
          },
        });
      } catch (error) {
        console.error("Error creating checkpoint:", error);
        return Response.json(
          {
            error: error instanceof Error
              ? error.message
              : "Unknown error",
          },
          { status: 500 },
        );
      }
    }

    if (
      url.pathname.startsWith("/api/checkpoints/") &&
      url.pathname.endsWith("/apply") &&
      req.method === "POST"
    ) {
      try {
        const checkpointId = url.pathname.split("/")[3];

        console.log(`🔄 Applying checkpoint: ${checkpointId}`);
        await agent.applyCheckpoint(checkpointId);

        return Response.json({ success: true });
      } catch (error) {
        console.error("Error applying checkpoint:", error);
        return Response.json(
          {
            error: error instanceof Error
              ? error.message
              : "Unknown error",
          },
          { status: 500 },
        );
      }
    }

    if (
      url.pathname.startsWith("/api/checkpoints/") &&
      req.method === "DELETE"
    ) {
      try {
        const checkpointId = url.pathname.split("/")[3];

        console.log(`🗑️  Deleting checkpoint: ${checkpointId}`);
        await checkpointManager.deleteCheckpoint(checkpointId);

        return Response.json({ success: true });
      } catch (error) {
        console.error("Error deleting checkpoint:", error);
        return Response.json(
          {
            error: error instanceof Error
              ? error.message
              : "Unknown error",
          },
          { status: 500 },
        );
      }
    }

    // ✅ NEW: POST /api/save-checkpoint - create and return checkpointId for current session
    if (url.pathname === '/api/save-checkpoint' && req.method === 'POST') {
      try {
        const body = await req.json();
        const sessionId = body.sessionId || String(Date.now());
        const checkpointName = `manual_interrupt_${sessionId}_${Date.now()}`;
        console.log(`💾 Creating manual checkpoint: ${checkpointName}`);
        const checkpoint = await checkpointManager.createCheckpoint(checkpointName);
        console.log(`✅ Checkpoint created: ${checkpoint.id}`);
        return new Response(JSON.stringify({ checkpointId: checkpoint.id }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error creating manual checkpoint:', error);
        return new Response(JSON.stringify({ error: (error instanceof Error) ? error.message : String(error) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // 404
    return new Response("Not Found", { status: 404 });
  });
}

// ✅ 报告存储和 GCS 服务初始化
const reportsStore = new Map<string, StoredReport>();
let storageService: GCSStorageService | null = null;

// 初始化 GCS 存储服务（可选）
try {
  if (Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS")) {
    storageService = new GCSStorageService();
    console.log("✅ GCS Storage Service initialized");
  } else {
    console.warn(
      "⚠️  GCS credentials not found, file storage disabled (files will work but won't be persisted)",
    );
  }
} catch (e) {
  console.warn("⚠️  Failed to initialize GCS Storage:", e);
  storageService = null;
}

// 生成报告 ID
function generateReportId(): string {
  return `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

if (import.meta.main) {
  await startServer();
}