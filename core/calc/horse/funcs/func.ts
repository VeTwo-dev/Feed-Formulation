import { HorseInput, HorseRequirements } from "@/core/types/types";

//================================== { Saving Data } ==================================//
import Feed from "../../../data/horseFeed.json";
import Requirement from "../../../data/horse.json";
const feed = Feed;
const req = Requirement as unknown as HorseRequirements;



//=======================================================================================//
//=======================================================================================//



//دالة التوجيه الديناميكي لتحديد حالة الحصان الغذائية من بين الـ 37 حالة المعتمدة

export function getHorseCondition(input: HorseInput): string {
  // --- 1. التحقق من المنطق (Validation Logic) ---
  
  // التحقق من أن الأنثى لا تجمع بين الحمل والرضاعة
  if (input.sex === 'female') {
    if (input.pregnantMonth && input.lactatingMonth) {
      throw new Error("Logic Error: Cannot be pregnant and lactating at the same time.");
    }
  }

  // --- 2. مرحلة النمو (Growing Phase) - الأولوية المطلقة ---
  if (input.ageInMonths <= 24) {
    const age = input.ageInMonths;
    const work = input.work;

    if (age <= 4) return 'growing_4m';
    if (age <= 6) return 'growing_6m';
    if (age <= 12) return 'growing_12m';
    
    if (age <= 18) {
      if (work === 'light') return 'growing_18m_light';
      if (work === 'moderate') return 'growing_18m_moderate';
      return 'growing_18m';
    } 
    if (work === 'light') return 'growing_24m_light';
    if (work === 'moderate') return 'growing_24m_moderate';
    if (work === 'heavy') return 'growing_24m_heavy';
    if (work === 'very_heavy') return 'growing_24m_very_heavy';
    return 'growing_24m';
  }
  // --- 3. مرحلة البالغين (Adult Phase) ---

  // أ. منطق الإناث
  if (input.sex === 'female') {
    if (input.pregnantMonth) return `pregnant_${Math.floor(input.pregnantMonth)}m`;
    if (input.lactatingMonth) return `lactating_${Math.floor(input.lactatingMonth)}m`;
    // إذا لم تكن عشار ولا مرضعة، تعامل كبالغ عادي (يتم التوجيه للعمل أو الصيانة أدناه)
  }
  // ب. منطق الذكور (الفحول)
  if (input.sex === 'male') {
    if (input.isBreeding) return 'stallions_breeding';
    // إذا كان ذكر (غير Breeding) وغير شغال، يذهب للـ non-breeding
    if (input.work === 'minimum' || input.work === 'average' || input.work === 'high') {
      return 'stallions_nonbreeding';
    }
  }
  // --- 4. منطق العمل (Working Horses) للجميع (ذكور/إناث غير عشار/خصيان) ---
  switch (input.work) {
    case 'light': return 'working_light';
    case 'moderate': return 'working_moderate';
    case 'heavy': return 'working_heavy';
    case 'very_heavy': return 'working_very_heavy';
    case 'minimum': return 'adult_minimum';
    case 'high': return 'adult_high';
    default: return 'adult_average';
  }
}


//=======================================================================================//
//=======================================================================================//


export function DFI(BW: number, range1: number, range2: number): [number, number] {
  const dfi1 = Number(((range1 / 100) * BW).toFixed(2));
  const dfi2 = Number(((range2 / 100) * BW).toFixed(2));
  return [dfi1, dfi2];
}


//=======================================================================================//
//=======================================================================================//

/**
 * 2. دالة حساب المعادن وتغطية العجز (الكالسيوم والفوسفور)
 */
export function calcMinerals(reqP: number, reqCa: number, providedP: number, providedCa: number) {
  const deficit_P = reqP - providedP;
  let dcp_Amount = 0;
  let dcp_Ca = 0;
  let dcp_P = 0;

  if (deficit_P > 0) {
    dcp_P = deficit_P;
    dcp_Amount = (dcp_P * 100) / feed.Dicalcium_phosphate.p;
    dcp_Ca = (dcp_Amount * feed.Dicalcium_phosphate.ca) / 100;
  }

  const currentCa = providedCa + dcp_Ca;
  const deficit_Ca = reqCa - currentCa;
  let limeStoneAmount = 0;
  let limeStone_Ca = 0;

  if (deficit_Ca > 0) {
    limeStone_Ca = deficit_Ca;
    limeStoneAmount = (limeStone_Ca * 100) / feed.Limestone.ca;
  }

  return { dcp_Amount, dcp_Ca, dcp_P, limeStoneAmount, limeStone_Ca };
}


//=======================================================================================//
//=======================================================================================//


/**
 * 3. دالة حساب الإضافات (الأملاح، البريمكس، البافر) بناءً على الموسم
 */
export function calcAddons(totalFeed: number, season: string) {
  const premixFactor = 0.3;
  const baseBuffer = (1 / 100) * totalFeed * 1000;
  const baseSalt = Number((10 * totalFeed).toFixed(2));

  const currentSeason = season.toLowerCase();
  const salt = currentSeason === "winter" ? Number((baseSalt / 2).toFixed(2)) : baseSalt;
  const premix = Number((premixFactor * 10 * totalFeed).toFixed(2));
  const buffer = Number(baseBuffer.toFixed(2));

  return { salt, premix, buffer };
}


//=======================================================================================//
//=======================================================================================//

// Types Definition
export interface FeedItemInput {
  name: string;   // Feed name dynamically passed (must match JSON keys)
  ratio?: number; // Optional: The internal proportion within its group
}

export interface DynamicPearsonResult {
  feedAmounts: Record<string, number>; // Output: { "Barseem_Hay": 2.5, "Corn": 1.2 }
  totalCP_kg: number;
  totalDE_mcal: number;
  totalCa_g: number;
  totalP_g: number;
}


//=======================================================================================//
//=======================================================================================//

// Helper: Normalizes internal ratios (e.g., if user gives 2 items without ratios, it assigns 50/50)
function normalizeRatios(items: FeedItemInput[]): (FeedItemInput & { normalizedRatio: number })[] {
  if (items.length === 0) return [];

  const hasAnyRatio = items.some(item => item.ratio !== undefined && item.ratio > 0);
  
  const weightedItems = items.map(item => ({
    ...item,
    weight: hasAnyRatio ? (item.ratio ?? 1) : 1 
  }));

  const totalWeight = weightedItems.reduce((sum, item) => sum + item.weight, 0);

  return weightedItems.map(item => ({
    ...item,
    normalizedRatio: item.weight / totalWeight
  }));
}


export function calculateDynamicPearson(
  roughageInputs: FeedItemInput[],
  concentrateInputs: FeedItemInput[],
  targetCP_Percent: number,   // The required CP percentage for the mix
  totalFeedAmountKg: number,  // Total DFI required
  feedDatabase: Record<string, any> // The Feed JSON
): DynamicPearsonResult {

  const roughages = normalizeRatios(roughageInputs);
  const concentrates = normalizeRatios(concentrateInputs);

  // Step 1: Calculate composite CP for Roughage Group
  let compositeRoughageCP = 0;
  roughages.forEach(r => {
    if (!feedDatabase[r.name]) throw new Error(`Feed ${r.name} not found in database.`);
    compositeRoughageCP += feedDatabase[r.name].cp * r.normalizedRatio;
  });

  // Step 2: Calculate composite CP for Concentrate Group
  let compositeConcCP = 0;
  concentrates.forEach(c => {
    if (!feedDatabase[c.name]) throw new Error(`Feed ${c.name} not found in database.`);
    compositeConcCP += feedDatabase[c.name].cp * c.normalizedRatio;
  });

  // Step 3: Pearson Square Validation
  const minCP = Math.min(compositeRoughageCP, compositeConcCP);
  const maxCP = Math.max(compositeRoughageCP, compositeConcCP);
  
  if (targetCP_Percent <= minCP || targetCP_Percent >= maxCP) {
    throw new Error(`Mathematical impossibility: Target CP (${targetCP_Percent}%) must be strictly between Composite Roughage (${compositeRoughageCP.toFixed(2)}%) and Composite Concentrate (${compositeConcCP.toFixed(2)}%).`);
  }

  // Step 4: Pearson Math
  const partsRoughage = Math.abs(compositeConcCP - targetCP_Percent);
  const partsConc = Math.abs(compositeRoughageCP - targetCP_Percent);
  const totalParts = partsRoughage + partsConc;

  const propRoughage = partsRoughage / totalParts;
  const propConc = partsConc / totalParts;

  // Step 5: Distribution and Nutrient Accumulation
  const result: DynamicPearsonResult = {
    feedAmounts: {},
    totalCP_kg: 0,
    totalDE_mcal: 0,
    totalCa_g: 0,
    totalP_g: 0
  };

  function processGroup(group: typeof roughages, groupProportion: number) {
    group.forEach(item => {
      // Calculate specific amount in Kg for this feed item
      const amountKg = totalFeedAmountKg * groupProportion * item.normalizedRatio;
      result.feedAmounts[item.name] = amountKg;

      const feedData = feedDatabase[item.name];
      
      // Accumulate Nutrients
      result.totalCP_kg += amountKg * (feedData.cp / 100);
      result.totalDE_mcal += amountKg * feedData.de;
      result.totalCa_g += amountKg * feedData.ca * 10; // Convert % to grams
      result.totalP_g += amountKg * feedData.p * 10;   // Convert % to grams
    });
  }

  processGroup(roughages, propRoughage);
  processGroup(concentrates, propConc);

  return result;
}



//=======================================================================================//
//=======================================================================================//
