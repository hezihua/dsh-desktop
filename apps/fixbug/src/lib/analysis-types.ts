export type AnalysisFinding = {
  area: string;
  detail: string;
  confidence: number;
};

export type AnalysisSolution = {
  title: string;
  steps: string[];
  risk: "low" | "medium" | "high" | "critical";
  automatable: boolean;
  requiredActions: Array<
    "analyze" | "read_repo" | "apply_local_fix" | "run_command"
  >;
};

export type StructuredAnalysisReport = {
  summary: string;
  problemLocation: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  findings: AnalysisFinding[];
  rootCauseHypotheses: string[];
  solutions: AnalysisSolution[];
  nextHumanDecision: string[];
  evidence: {
    message: string;
    stackExcerpt?: string;
    traceId?: string | null;
    fingerprint?: string | null;
    source?: string | null;
  };
};
