import { bullet_slides } from "./bullet_slides.js";
import { compare_tabs } from "./compare_tabs.js";
import { outline_doc } from "./outline_doc.js";
import { regroup_windows } from "./regroup_windows.js";
import { research_brief } from "./research_brief.js";
import { summarize_email } from "./summarize_email.js";
import type { ActionDef } from "./_shared.js";

export const ACTIONS: Readonly<Record<string, ActionDef>> = Object.freeze({
  summarize_email,
  outline_doc,
  bullet_slides,
  compare_tabs,
  research_brief,
  regroup_windows,
});

export const ACTION_IDS: readonly string[] = Object.freeze(Object.keys(ACTIONS));
