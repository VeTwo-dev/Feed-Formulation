// -----------------------------------------------------------------------------
// 4. INTERNAL — nutrient totals + CLI-table row formatting
// -----------------------------------------------------------------------------

import { AnimalRequirements, DietTableRow, FeedDatabase, NutrientTotals, VarEntry } from "../forceDynamicFormulation";
import { isMineral } from "../mineralLimitation";

export function sumNutrients(feedAmounts: Record<string, number>, feedDatabase: FeedDatabase): NutrientTotals {
  return Object.entries(feedAmounts).reduce<NutrientTotals>(
    (totals, [name, kg]) => {
      const fd = feedDatabase[name];
      if (!fd || kg <= 0) return totals;
      return {
        cp_kg: totals.cp_kg + kg * (fd.cp / 100),
        de_mcal: totals.de_mcal + kg * fd.de,
        ca_g: totals.ca_g + kg * (fd.ca / 100) * 1000,
        p_g: totals.p_g + kg * (fd.p / 100) * 1000,
        dm_kg: totals.dm_kg + kg,
      };
    },
    { cp_kg: 0, de_mcal: 0, ca_g: 0, p_g: 0, dm_kg: 0 }
  );
}





export function buildRows(
  vars: VarEntry[],
  feedAmounts: Record<string, number>,
  animal: AnimalRequirements,
  totals: NutrientTotals
): DietTableRow[] {
  const rows: DietTableRow[] = [];

  const intakeDisplay =
    typeof animal.totalIntakeKg === "number"
      ? `${animal.totalIntakeKg.toFixed(2)} Kg`
      : `${animal.totalIntakeKg.min.toFixed(2)} - ${animal.totalIntakeKg.max.toFixed(2)} Kg`;

  rows.push({
    feedStuff: "Nutrient Requirement (NR)",
    amount: intakeDisplay,
    cp: `${animal.reqCP_kg.toFixed(3)} Kg`,
    de: `${animal.reqDE_mcal.toFixed(2)} Mcal`,
    ca: `${animal.reqCa_g.toFixed(2)} g`,
    p: `${animal.reqP_g.toFixed(2)} g`,
  });

  for (const v of vars) {
    const amtKg = feedAmounts[v.feedName] ?? 0;
    if (amtKg <= 1e-6) continue; // only feeds the solver actually chose
    const fd = v.fd;

    if(isMineral(fd)){
      const amtG = amtKg * 1000;
      rows.push({
        feedStuff: v.feedName,
        amount: `${amtG.toFixed(2)} g`,
        cp: "---",
        de: "---",
        ca: fd.ca > 0 ? `${(amtKg * (fd.ca / 100) * 1000).toFixed(2)} g` : "---",
        p: fd.p > 0 ? `${(amtKg * (fd.p / 100) * 1000).toFixed(2)} g` : "---",
      });
    } else {
      rows.push({
        feedStuff: v.feedName,
        amount: `${amtKg.toFixed(2)} kg`,
        cp: `${(amtKg * (fd.cp / 100)).toFixed(3)}`,
        de: `${(amtKg * fd.de).toFixed(2)}`,
        ca: `${(amtKg * (fd.ca / 100) * 1000).toFixed(2)} g`,
        p: `${(amtKg * (fd.p / 100) * 1000).toFixed(2)} g`,
      });
    }
  }

  rows.push({
    feedStuff: "Total Achieved",
    amount: `${totals.dm_kg.toFixed(2)} kg`,
    cp: `${totals.cp_kg.toFixed(2)} Kg`,
    de: `${totals.de_mcal.toFixed(2)} Mcal`,
    ca: `${totals.ca_g.toFixed(2)} g`,
    p: `${totals.p_g.toFixed(2)} g`,
  });

  return rows;
}
