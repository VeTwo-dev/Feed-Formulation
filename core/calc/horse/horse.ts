//=========================================================================================//
//================================== { Import the Data } ==================================//
//=========================================================================================//
import Feed from "../../data/horseFeed.json";
import Requirement from "../../data/horse.json";
import { calcAddons, calcMinerals, DFI, getHorseCondition } from "./funcs/func";
import { CalculationResult, HorseInput, HorseRequirements } from "../../types/types";


//=====================================================================================//
//================================== { Saving Data } ==================================//
//=====================================================================================//

const feed = Feed;
const req = Requirement as unknown as HorseRequirements;

//============================================================================================//
//==================================== { Helper Functions } ==================================//
//============================================================================================//
/**
 * 1. دالة حساب الأعلاف الأساسية (الدريس والتبن)
 */
function calcBaseForage(CP: number, DE: number) {
  const hayAmount = (CP * 100) / feed.Barseem_Hay.cp;
  const hayEnergy = hayAmount * feed.Barseem_Hay.de;
  const hay_Ca = hayAmount * feed.Barseem_Hay.ca * 10;
  const hay_P = hayAmount * feed.Barseem_Hay.p * 10;

  const wheatStrawEnergy = DE - hayEnergy;
  const wheatStrawAmount = wheatStrawEnergy / feed.Wheat_straw.de;
  const wheatStraw_Ca = wheatStrawAmount * feed.Wheat_straw.ca * 10;
  const wheatStraw_P = wheatStrawAmount * feed.Wheat_straw.p * 10;

  return {
    hayAmount,
    hayEnergy,
    hay_Ca,
    hay_P,
    wheatStrawAmount,
    wheatStrawEnergy,
    wheatStraw_Ca,
    wheatStraw_P,
    totalForage: hayAmount + wheatStrawAmount
  };
}

//=======================================================================================//
//================================== { Main Function } ==================================//
//=======================================================================================//

export function calculateSingelSource(bw: number, season: string, params: HorseInput): CalculationResult {
  const gender = params.sex;
  const horseCondition = getHorseCondition(params);
  const bwKey = bw.toString();

  // التحقق من وجود البيانات
  if (!req.requirements[bwKey] || !req.requirements[bwKey][horseCondition]) {
    throw new Error(`Data not found in requirements for BW: ${bw} and Condition: ${horseCondition}`);
  }
  if (!req.consumptionRange || !req.consumptionRange[horseCondition]) {
    throw new Error(`Data not found in consumptionRange for Condition: ${horseCondition}`);
  }

  // سحب المتطلبات الأساسية
  const requirement = req.requirements[bwKey][horseCondition];
  const CP: number = requirement.cp / 1000;
  const DE: number = requirement.de;
  const CA: number = requirement.ca;
  const P: number = requirement.p;

  const totalRange = req.consumptionRange[horseCondition].total;
  const feedAmount = DFI(bw, totalRange[0], totalRange[1]);

  // --- { استدعاء الدوال المساعدة لتنفيذ العمليات } ---

  // 1. حساب الأعلاف
  const forage = calcBaseForage(CP, DE);

  // 2. حساب المعادن
  const provided_P = forage.hay_P + forage.wheatStraw_P;
  const provided_Ca = forage.hay_Ca + forage.wheatStraw_Ca;
  const minerals = calcMinerals(P, CA, provided_P, provided_Ca);

  // 3. حساب الإضافات
  const addons = calcAddons(forage.totalForage, season);

  // --- { تطبيق منطق الفصول (Season Logic) } ---
  
  let finalHayName = "Berseem Hay";
  let finalHayAmount = forage.hayAmount;
  let finalWheatStrawName = "Wheat Straw";
  let finalWheatStrawAmount = forage.wheatStrawAmount;
  
  let dynamicComment = "";

    if (season.toLowerCase() === "winter") {
    // finalHayName = "Green Barseem";
    // finalHayAmount = hayAmount * 5;
    dynamicComment = `Winter Diet: Berseem Hay replaced with Green Barseem (Factor x5).`;
  } else if (season.toLowerCase() === "summer") {
    // finalWheatStrawName = "Darahawah";
    // finalWheatStrawAmount = wheatStrawAmount * 4;
    dynamicComment = `Summer Diet: WheatStraw replaced with Darahawah (Factor x4).`;
  }

  // --- { حساب الإجمالي النهائي } ---
  const feedAddonsAmount = (addons.buffer + addons.premix + addons.salt + minerals.dcp_Amount + minerals.limeStoneAmount) / 1000;
  const TotalAmount = forage.totalForage + feedAddonsAmount;

  // Final output
  return {
    title: `Nutrient Requirements & Feed Plan for ${horseCondition} ${gender} Horse (${bw}kg) - ${season.toUpperCase()}`,
    rows: [
      { feedStuff: "Nutrient Requirement (NR)", amount: `${feedAmount[0]}-${feedAmount[1]} Kg`, cp: CP.toFixed(3) + " Kg", de: DE.toFixed(2) + " Mcal/Kg", ca: CA + " g", p: P + " g" },
      { feedStuff: finalHayName, amount: finalHayAmount.toFixed(2) + " kg", cp: CP.toFixed(3), de: forage.hayEnergy.toFixed(2), ca: `${forage.hay_Ca.toFixed(2)} g`, p: `${forage.hay_P.toFixed(2)} g` },
      { feedStuff: finalWheatStrawName, amount: finalWheatStrawAmount.toFixed(2) + " kg", cp: "---", de: forage.wheatStrawEnergy.toFixed(2), ca: `${forage.wheatStraw_Ca.toFixed(2)} g`, p: `${forage.wheatStraw_P.toFixed(2)} g` },
      { feedStuff: "Salt", amount: `${addons.salt} g`, cp: "---", de: "---", ca: `---`, p: `---` },
      { feedStuff: "Equine Premix", amount: `${addons.premix} g`, cp: "---", de: "---" , ca: `---`, p: `---`},
      { feedStuff: "Buffer", amount: `${addons.buffer} g`, cp: "---", de: "---" , ca: `---`, p: `---`},
      { feedStuff: "DCP", amount: `${minerals.dcp_Amount.toFixed(2)} g`, cp: "---", de: "---", ca: `${minerals.dcp_Ca.toFixed(2)} g`, p: `${minerals.dcp_P.toFixed(2)} g` },
      { feedStuff: "Lime Stone", amount: `${minerals.limeStoneAmount.toFixed(2)} g`, cp: "---", de: "---", ca: `${minerals.limeStone_Ca.toFixed(2)} g`, p: `---` },
      { feedStuff: "Total", amount: TotalAmount.toFixed(2) + " kg", cp: "---", de: "---" }
    ] as any,
    comment: dynamicComment
  };
}


// Finish Person Square in general Functions in all animals  

// Premix calculation according to BW - condition - Premix amount
