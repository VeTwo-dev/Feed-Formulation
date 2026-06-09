import { CalculationResult } from "../types/types";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Feed = require("../data/horseFeed.json");
const Requirement = require("../data/horse.json");


const feed = Feed
const horse = Requirement;

function DFI(BW: number, range1: number, range2: number): [number, number] {
  const dfi1 = (range1 / 100) * BW;
  const dfi2 = (range2 / 100) * BW;
  return [dfi1, dfi2];
}

export function calculateSingelSource(bw: number, season: string, horseCondition: string = "good"): CalculationResult {
  const CP = 0.504; // kg
  const DE = 13.3;  // mcal
  const feedAmount = DFI(bw, 1.5, 2);

  // 1. الحسابات الأساسية الجافة (Base Dry Calculations)
  const hayAmount = (CP * 100) / 13.4;
  const hayEnergy = hayAmount * 2; 

  const tibnEnergy = DE - hayEnergy;
  const tibnAmount = tibnEnergy / 1.48;

  // 2. تطبيق منطق الفصول (Season Logic) بناءً على السلايد
  let finalHayName = "Berseem Hay";
  let finalHayAmount = hayAmount;

  let finalTibnName = "Tibn";
  let finalTibnAmount = tibnAmount;
  
  let dynamicComment = "";

  if (season.toLowerCase() === "winter") {
    // الشتاء: استبدال الدريس بالبرسيم الأخضر (ضرب في 5)
    finalHayName = "Green Barseem";
    finalHayAmount = hayAmount * 5;
    dynamicComment = `Winter Diet: Berseem Hay replaced with Green Barseem (Factor x5).`;
  } else if (season.toLowerCase() === "summer") {
    // الصيف: استبدال التبن بالدراوة (ضرب في 4)
    finalTibnName = "Darahawah";
    finalTibnAmount = tibnAmount * 4;
    dynamicComment = `Summer Diet: Tibn replaced with Darahawah (Factor x4).`;
  }

  // حساب إجمالي وزن العلف الكلي لحساب الإضافات (Addons)
  const totalFeed = finalHayAmount + finalTibnAmount;

  // 3. حساب الإضافات (Addons Check)
  function addonCheck(currentSeason: string): { salt: number; premix: number; buffer: number } {
    const premixFactor = 0.3;
    
    // حساب الـ Buffer بناءً على معادلة الصورة: (1 / 100) * المجموع * 1000 لتحويلها لجرام مثلاً
    // هثبتها هنا على حسب النسبة المئوية من حجم العلف الكلي
    const baseBuffer = (1 / 100) * totalFeed * 1000; // بالجرام كمثال أو سيبها كنسبة

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