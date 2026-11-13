import { z } from "zod";

export const sshHostSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64),
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1).max(64),
  /** 仅支持私钥（推荐）；密码不落库 */
  privateKeyPath: z.string().min(1).max(512),
});

export type SshHost = z.infer<typeof sshHostSchema>;

export type SshHostPublic = Pick<
  SshHost,
  "id" | "name" | "host" | "port" | "username"
> & {
  privateKeyPath: string;
};
