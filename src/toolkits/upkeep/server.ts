import { defineToolkit } from "../define";
import { upkeep as manifest } from "./manifest";
import { upkeepTools } from "./upkeep";

export const upkeep = defineToolkit(manifest, { tools: upkeepTools });
