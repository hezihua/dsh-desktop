export type SkillMeta = {
  name: string;
  description: string;
  /** 触发关键词（小写匹配用户问题 / 报告摘要） */
  triggers: string[];
  source: "agent";
  path: string;
  readonly: boolean;
};

export type SkillRecord = SkillMeta & {
  body: string;
};

export type SkillSummary = Pick<
  SkillRecord,
  "name" | "description" | "triggers" | "source" | "path" | "readonly"
>;
