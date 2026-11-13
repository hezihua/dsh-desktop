import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

export function createId(prefix: string) {
  return `${prefix}_${nanoid()}`;
}
