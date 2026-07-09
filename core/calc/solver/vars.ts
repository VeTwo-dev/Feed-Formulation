import { FeedDatabase, UserFeedInput, VarEntry } from "../forceDynamicFormulation";

export function collectVars(
  feedDatabase: FeedDatabase,
  roughages: UserFeedInput[],
  concentrates: UserFeedInput[],
  minerals: UserFeedInput[]
): VarEntry[] {
  const vars: VarEntry[] = [];
  let idx = 0;

  const addGroup = (inputs: UserFeedInput[], group: VarEntry["group"]) => {
    for (const f of inputs) {
      const fd = feedDatabase[f.name];
      if (!fd) {
        throw new Error(`Feed "${f.name}" not found in feedDatabase.`);
      }
      if (f.ratio !== undefined && f.ratio < 0) {
        throw new Error(`Feed "${f.name}" has a negative ratio (${f.ratio}); ratios must be >= 0.`);
      }
      vars.push({
    varName: `f${idx++}`,
    feedName: f.name,
    group,
    ratio: f.ratio,
    minKg: f.minKg,
    maxKg: f.maxKg,
    fd,
});
    }
  };

  addGroup(roughages ?? [], "roughage");
addGroup(concentrates ?? [], "concentrate");
addGroup(minerals ?? [], "mineral");

  return vars;
}
