// ==========================================
// Types & Imports
// ==========================================

export interface FeedItemInput {
  name: string;
  ratio?: number; // النسبة الافتراضية داخل المجموعة (اختيارية)
}

export interface DietCalculationResult {
  feedAmounts: Record<string, number>;
  minerals: {
    dcp_Amount_g: number;
    dcp_Ca_g: number;
    dcp_P_g: number;
    limeStoneAmount_g: number;
    limeStone_Ca_g: number;
  };
  totals: {
    cp_kg: number;
    de_mcal: number;
    ca_g: number;
    p_g: number;
  };
}





// ==========================================
// Main Unified Function (Linear Programming)
// ==========================================
// export function calculateDietLP(
//   userInputFeeds: FeedItemInput[],
//   targetCP_Percent: number,
//   totalFeedAmountKg: number,
//   reqP_g: number,
//   reqCa_g: number,
//   feedDatabase: Record<string, any>
// ): DietCalculationResult {

//   // 1. بناء هيكل نموذج البرمجة الخطية
//   const model: any = {
//     optimize: "cost", // السولفر يحتاج لهدف، سنجعل التكلفة وهمية لنجعله يركز على ضبط الكميات
//     opType: "min",
//     constraints: {
//       weight: { equal: totalFeedAmountKg }, // قيد: يجب أن يكون إجمالي الوزن مطابقاً لاحتياج الحصان
//       cp: { equal: totalFeedAmountKg * (targetCP_Percent / 100) } // قيد: كمية البروتين بالكيلوجرام
//     },
//     variables: {}
//   };

//   const roughages: FeedItemInput[] = [];
//   const concentrates: FeedItemInput[] = [];

//   // 2. تسجيل المتغيرات (أنواع العلف) في السولفر وتصنيفها
//   for (const item of userInputFeeds) {
//     const feedData = feedDatabase[item.name];
//     if (!feedData) throw new Error(`Feed item '${item.name}' not found.`);

//     // إنشاء المتغير بخصائصه الأساسية
//     model.variables[item.name] = {
//       weight: 1,
//       cp: feedData.cp / 100, // النسبة ككسر عشري
//       cost: feedData.cost || 1 // تكلفة افتراضية لإرضاء محرك السولفر
//     };

//     const type = feedData.type?.toLowerCase();
//     if (type === "roughage") roughages.push(item);
//     else if (type === "protein" || type === "energy") concentrates.push(item);
//   }

//   // 3. دالة سحرية لتحويل نِسَب المستخدم إلى "قيود جبرية" للسولفر
//   const applyGroupRatios = (groupName: string, items: FeedItemInput[]) => {
//     if (items.length <= 1) return;

//     const base = items[0];
//     const baseRatio = (base.ratio && base.ratio > 0) ? base.ratio : 1;

//     for (let i = 1; i < items.length; i++) {
//       const current = items[i];
//       const currentRatio = (current.ratio && current.ratio > 0) ? current.ratio : 1;

//       // إنشاء قيد جديد يربط المادة الأولى بالمادة الحالية
//       const constraintName = `ratio_${groupName}_${i}`;
//       model.constraints[constraintName] = { equal: 0 };
      
//       // المعادلة: (المادة الأساسية * نسبة الحالي) - (المادة الحالية * نسبة الأساسي) = 0
//       model.variables[base.name][constraintName] = currentRatio;
//       model.variables[current.name][constraintName] = -baseRatio;
//     }
//   };

//   // تطبيق القيود على المجموعتين (مما يغني عن حساب الرافيج والمركز الاعتباري)
//   applyGroupRatios("roughage", roughages);
//   applyGroupRatios("concentrate", concentrates);

//   // 4. تنفيذ الحل
//   const result = solver.Solve(model) as any;
// console.log("Selected Feeds CP:", userInputFeeds.map(f => ({ name: f.name, cp: feedDatabase[f.name].cp })));
// console.log("Target CP:", targetCP_Percent);
//   // إذا كانت نسبة البروتين المطلوبة مستحيلة التحقيق بالمواد المدخلة
//   if (!result.feasible) {
//     throw new Error(`LP Solver failed: Target CP (${targetCP_Percent.toFixed(2)}%) cannot be achieved mathematically with the given feeds and ratios.`);
//   }

//   // 5. استخراج النتائج وحصاد المغذيات
//   const feedAmounts: Record<string, number> = {};
//   let totalCP_kg = 0;
//   let totalDE_mcal = 0;
//   let totalCa_g = 0;
//   let totalP_g = 0;

//   for (const item of userInputFeeds) {
//     // السولفر يتجاهل المتغيرات التي قيمتها 0 من النتيجة، لذا نضع 0 كبديل
//     const amountKg = result[item.name] || 0;
//     feedAmounts[item.name] = amountKg;

//     if (amountKg > 0) {
//       const data = feedDatabase[item.name];
//       totalCP_kg += amountKg * (data.cp / 100);
//       totalDE_mcal += amountKg * data.de;
//       totalCa_g += amountKg * data.ca * 10;
//       totalP_g += amountKg * data.p * 10;
//     }
//   }

//   // 6. دالة المعادن المدمجة لحساب العجز
//   const calcMinerals = (reqP: number, reqCa: number, provP: number, provCa: number) => {
//     const deficitP = reqP - provP;
//     let dcp_Amount_g = 0, dcp_Ca_g = 0, dcp_P_g = 0;

//     if (deficitP > 0) {
//       dcp_P_g = deficitP;
//       const dcpData = feedDatabase["Dicalcium_phosphate"] || { p: 18, ca: 21 }; 
//       dcp_Amount_g = (dcp_P_g * 100) / dcpData.p;
//       dcp_Ca_g = (dcp_Amount_g * dcpData.ca) / 100;
//     }

//     const currentCa = provCa + dcp_Ca_g;
//     const deficitCa = reqCa - currentCa;
//     let limeStoneAmount_g = 0, limeStone_Ca_g = 0;

//     if (deficitCa > 0) {
//       limeStone_Ca_g = deficitCa;
//       const limeData = feedDatabase["Limestone"] || { ca: 34 };
//       limeStoneAmount_g = (limeStone_Ca_g * 100) / limeData.ca;
//     }

//     return { dcp_Amount_g, dcp_Ca_g, dcp_P_g, limeStoneAmount_g, limeStone_Ca_g };
//   };

//   const minerals = calcMinerals(reqP_g, reqCa_g, totalP_g, totalCa_g);

//   // 7. إرجاع النتيجة
//   return {
//     feedAmounts,
//     minerals,
//     totals: {
//       cp_kg: totalCP_kg,
//       de_mcal: totalDE_mcal,
//       ca_g: totalCa_g,
//       p_g: totalP_g
//     }
//   };
// }



//=======================================================================================//
//=======================================================================================//

/**
 * دالة لفلترة الـ JSON الخاص بالأعلاف
 */

interface FeedItem {
  type: string | string[];
  cp: number | null;
  [key: string]: any; // لأي خصائص أخرى
}

export function filterFeeds(
  database: Record<string, any>,
  condition: (item: FeedItem) => boolean
) {
  // 1. Object.entries: تحول {key: value} إلى [[key, value], [key, value]]
  // 2. filter: نقوم بفلترة المصفوفة بناءً على الشرط
  // 3. Object.fromEntries: تعيد المصفوفة المفلترة إلى شكل {key: value}
  
  return Object.fromEntries(
    Object.entries(database).filter(([key, value]) => condition(value))
  );}

//   Testing .....
// const roughages = filterFeeds(feed, (item) => item.type === "roughage");
// console.log(roughages)

//=======================================================================================//
//=======================================================================================//

