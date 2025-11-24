// filepath: /Users/jianan/Documents/market-research-agent/services/toolApprovalService.ts

interface PendingApproval {
  id: string;
  toolName: string;
  toolArgs: Record<string, any>;
  checkpointId: string;
  sessionId: string;
  createdAt: Date;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
}

class ToolApprovalService {
  private pendingApprovals: Map<string, PendingApproval> = new Map();

  /**
   * Create a new approval request
   */
  createApproval(
    toolName: string,
    toolArgs: Record<string, any>,
    checkpointId: string,
    sessionId: string
  ): PendingApproval {
    const approval: PendingApproval = {
      id: `approval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      toolName,
      toolArgs,
      checkpointId,
      sessionId,
      createdAt: new Date(),
      status: 'pending',
    };

    this.pendingApprovals.set(approval.id, approval);
    
    console.log(`🔔 Created approval request: ${approval.id}`);
    console.log(`   Tool: ${toolName}`);
    console.log(`   Args: ${JSON.stringify(toolArgs)}`);

    return approval;
  }

  /**
   * Get an approval by ID
   */
  getApproval(approvalId: string): PendingApproval | undefined {
    return this.pendingApprovals.get(approvalId);
  }

  /**
   * Approve a tool call
   */
  approve(approvalId: string, reason?: string): boolean {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval) {
      console.error(`❌ Approval not found: ${approvalId}`);
      return false;
    }

    approval.status = 'approved';
    approval.reason = reason;
    
    console.log(`✅ Approval granted: ${approvalId}`);
    console.log(`   Tool: ${approval.toolName}`);
    
    return true;
  }

  /**
   * Reject a tool call
   */
  reject(approvalId: string, reason?: string): boolean {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval) {
      console.error(`❌ Approval not found: ${approvalId}`);
      return false;
    }

    approval.status = 'rejected';
    approval.reason = reason;
    
    console.log(`❌ Approval rejected: ${approvalId}`);
    console.log(`   Tool: ${approval.toolName}`);
    console.log(`   Reason: ${reason || 'User rejected'}`);
    
    return true;
  }

  /**
   * Check if an approval is approved
   */
  isApproved(approvalId: string): boolean {
    const approval = this.pendingApprovals.get(approvalId);
    return approval?.status === 'approved';
  }

  /**
   * Check if an approval is rejected
   */
  isRejected(approvalId: string): boolean {
    const approval = this.pendingApprovals.get(approvalId);
    return approval?.status === 'rejected';
  }

  /**
   * Clean up old approvals (older than 1 hour)
   */
  cleanup(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    
    for (const [id, approval] of this.pendingApprovals.entries()) {
      if (approval.createdAt.getTime() < oneHourAgo) {
        this.pendingApprovals.delete(id);
        console.log(`🗑️ Cleaned up old approval: ${id}`);
      }
    }
  }
}

// Export singleton instance
export const toolApprovalService = new ToolApprovalService();

// Clean up every 10 minutes
setInterval(() => {
  toolApprovalService.cleanup();
}, 10 * 60 * 1000);
