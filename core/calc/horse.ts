import { CalculationResult } from "../types/types";
import { createRequire } from "module";

//============ { Type Definitions for Dynamic JSON } ===============//

interface NutrientValues {
  de: number;
  cp: number;
  [key: string]: number; 
}

interface HorseRequirements {
  requirements: {
    [bw: string]: {
      [condition: string]: NutrientValues;
    };
  };
  consumptionRange: { // تعديل التهجئة هنا بحرف p
    [condition: string]: {
      forage: number[];
      concentrate: number[];
      total: number[]; // تعديل النوع إلى مصفوفة أرقام
    };
  };
}

//============ { Import the Data } ===============//
// const require = createRequire(import.meta.url);
import Feed from "../data/horseFeed.json";
import Requirement from "../data/horse.json";



//============ { Saving Data & Type Casting } ===============//
const feed = Feed;
const req = Requirement as unknown as HorseRequirements;

function DFI(BW: number, range1: number, range2: number): [number, number] {
  const dfi1 = Number(((range1 / 100) * BW).toFixed(2));
  const dfi2 = Number(((range2 / 100) * BW).toFixed(2));
  return [dfi1, dfi2];
}





//============ { Main Function } ===============//

export function calculateSingelSource(bw: number, season: string, horseCondition: string): CalculationResult {
  
  const bwKey = bw.toString();

  // التحقق الدفاعي للتأكد من وجود البيانات وتجنب الـ Crash
  if (!req.requirements[bwKey] || !req.requirements[bwKey][horseCondition]) {
    throw new Error(`Data not found in requirements for BW: ${bw} and Condition: ${horseCondition}`);
  }

  if (!req.consumptionRange || !req.consumptionRange[horseCondition]) {
    throw new Error(`Data not found in consumptionRange for Condition: ${horseCondition}`);
  }

  const CP: number = req.requirements[bwKey][horseCondition].cp / 1000; // kg
  const DE: number = req.requirements[bwKey][horseCondition].de;  // mcal

  // الوصول المباشر للمصفوفة بدون الحاجة لعمل split أو تحويل نصوص
  const totalRange = req.consumptionRange[horseCondition].total; // [1.5, 2.0]
  const feedAmount = DFI(bw, totalRange[0], totalRange[1]);

  // 1. الحسابات الأساسية الجافة (Base Dry Calculations)
  const hayAmount = (CP * 100) / 13.4;
  const hayEnergy = hayAmount * 2; 

  const tibnEnergy = DE - hayEnergy;
  const tibnAmount = tibnEnergy / 1.48;

  // 2. تطبيق منطق الفصول (Season Logic)
  let finalHayName = "Berseem Hay";
  let finalHayAmount = hayAmount;

  let finalTibnName = "Tibn";
  let finalTibnAmount = tibnAmount;
  
  let dynamicComment = "";

  if (season.toLowerCase() === "winter") {
    finalHayName = "Green Barseem";
    finalHayAmount = hayAmount * 5;
    dynamicComment = `Winter Diet: Berseem Hay replaced with Green Barseem (Factor x5).`;
  } else if (season.toLowerCase() === "summer") {
    finalTibnName = "Darahawah";
    finalTibnAmount = tibnAmount * 4;
    dynamicComment = `Summer Diet: Tibn replaced with Darahawah (Factor x4).`;
  }

  const totalFeed = finalHayAmount + finalTibnAmount;

  // 3. حساب الإضافات (Addons Check)
  function addonCheck(currentSeason: string): { salt: number; premix: number; buffer: number } {
    const premixFactor = 0.3;
    const baseBuffer = (1 / 100) * totalFeed * 1000; 

    const summerAddons = {
      salt: Number((10 * totalFeed).toFixed(2)),
      premix: Number((premixFactor * 10 * totalFeed).toFixed(2)),
      buffer: Number(baseBuffer.toFixed(2))
    };

    if (currentSeason.toLowerCase() === "winter") {
      return {
        salt: Number((summerAddons.salt / 2).toFixed(2)), 
        premix: summerAddons.premix, 
        buffer: summerAddons.buffer  
      };
    }

    return summerAddons;
  }

  const feedAddons = addonCheck(season);

  // 4. بناء مخرجات الجدول النهائية
  return {
    title: `Nutrient Requirements & Feed Plan for ${horseCondition} Horse (${bw}kg) - ${season.toUpperCase()}`,
    rows: [
      { feedStuff: "Nutrient Requirement (NR)", amount: `${feedAmount[0]}-${feedAmount[1]} kg`, cp: CP, de: DE },
      { feedStuff: finalHayName, amount: finalHayAmount.toFixed(2) + " kg", cp: CP.toFixed(3), de: hayEnergy.toFixed(2) },
      { feedStuff: finalTibnName, amount: finalTibnAmount.toFixed(2) + " kg", cp: "---", de: tibnEnergy.toFixed(2) },
      { feedStuff: "Salt", amount: `${feedAddons.salt} g`, cp: "---", de: "---" },
      { feedStuff: "Equine Premix", amount: `${feedAddons.premix} g`, cp: "---", de: "---" },
      { feedStuff: "Buffer", amount: `${feedAddons.buffer} g`, cp: "---", de: "---" }
    ],
    comment: dynamicComment
  };
}