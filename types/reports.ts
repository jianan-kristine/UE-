// filepath: /Users/jianan/Documents/market-research-agent/types/reports.ts

export interface StoredReport {
  id: string;
  fileId?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  idea: string;
  mode: "quick" | "deep";
  language: string;
  persona?: "pm" | "vc" | "growth" | "tech";
  model?: string;
  fullReport: string;
  interrupted: boolean;
  checkpointId?: string;
  sessionId?: string;
  progress?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReportListItem {
  id: string;
  fileName?: string;
  idea: string;
  mode: string;
  persona?: string;
  interrupted: boolean;
  progress?: number;
  createdAt: string;
}
