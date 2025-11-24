// filepath: /Users/jianan/Documents/market-research-agent/utils/toolApprovalHelper.ts

import { toolApprovalService } from "../services/toolApprovalService.ts";

export interface ToolCallRequest {
  toolName: string;
  toolArgs: Record<string, any>;
}

export interface ApprovalCheckResult {
  needsApproval: boolean;
  approvalId?: string;
  toolName?: string;
  toolArgs?: Record<string, any>;
  checkpointId?: string;
}

/**
 * Check if a tool call needs approval
 * Returns approval request details if needed, otherwise null
 */
export function checkToolApproval(
  requireApproval: boolean,
  toolName: string,
  toolArgs: Record<string, any>,
  checkpointId: string,
  sessionId: string
): ApprovalCheckResult | null {
  
  // Only check Firecrawl tools for now
  const firecrawlTools = [
    'firecrawl_scrape',
    'firecrawl_crawl',
    'firecrawl_map',
    'firecrawl_search'
  ];

  const needsApproval = requireApproval && firecrawlTools.includes(toolName);

  if (!needsApproval) {
    return null;
  }

  // Create approval request
  const approval = toolApprovalService.createApproval(
    toolName,
    toolArgs,
    checkpointId,
    sessionId
  );

  return {
    needsApproval: true,
    approvalId: approval.id,
    toolName: approval.toolName,
    toolArgs: approval.toolArgs,
    checkpointId: approval.checkpointId,
  };
}

/**
 * Wait for approval decision
 * This is a synchronous check - the frontend will handle the async flow
 */
export function isToolCallApproved(approvalId: string): boolean {
  return toolApprovalService.isApproved(approvalId);
}

/**
 * Check if tool call was rejected
 */
export function isToolCallRejected(approvalId: string): boolean {
  return toolApprovalService.isRejected(approvalId);
}

/**
 * Example usage in analyze endpoint:
 * 
 * // Before calling a Firecrawl tool:
 * if (requireToolApproval) {
 *   const approvalCheck = checkToolApproval(
 *     requireToolApproval,
 *     'firecrawl_scrape',
 *     { url: targetUrl, formats: ['markdown'] },
 *     checkpointId,
 *     sessionId
 *   );
 *   
 *   if (approvalCheck) {
 *     // Return approval request to frontend
 *     return res.json({
 *       needsApproval: true,
 *       approvalId: approvalCheck.approvalId,
 *       toolName: approvalCheck.toolName,
 *       toolArgs: approvalCheck.toolArgs,
 *       checkpointId: approvalCheck.checkpointId,
 *     });
 *   }
 * }
 * 
 * // When continuing with a checkpointId:
 * if (lastApprovalId && isToolCallRejected(lastApprovalId)) {
 *   return res.json({
 *     error: 'Tool call was rejected by user',
 *     interrupted: true,
 *   });
 * }
 */
