// filepath: /Users/jianan/Documents/market-research-agent/types/approval.ts

export interface ToolApprovalRequest {
  approvalId: string;
  sessionId: string;
  toolName: string;
  toolArgs: any;
  timestamp: string;
}

export interface ToolApprovalResponse {
  approvalId: string;
  approved: boolean;
  reason?: string;
}

export interface PendingApproval {
  approvalId: string;
  sessionId: string;
  toolName: string;
  toolArgs: any;
  timestamp: Date;
  resolve?: (approved: boolean) => void;
}
