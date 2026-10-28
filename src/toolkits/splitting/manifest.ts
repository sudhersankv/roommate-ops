import type { ToolkitManifest } from "../types";
import { moneyTools } from "./money";
import { receiptTools } from "./receipts";
import { splitwiseTools } from "./splitwise";

export const splitting = {
  id: "splitting",
  name: "Splitting",
  description: "Shared Expenses (any split, several payers, receipts), Balances, settling up with pay links, and Splitwise import/export.",
  tools: { ...moneyTools, ...receiptTools, ...splitwiseTools },
} satisfies ToolkitManifest;
