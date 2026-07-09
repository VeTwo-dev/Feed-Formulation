
//================================== { Horse Types } ==================================//


export interface FeedRow {
  feedStuff: string;
  amount: string | number;
  cp: string | number;
  de: string | number;
}

export interface CalculationResult {
  title: string;
  rows: FeedRow[];
  comment:string
}
export interface NutrientValues {
  de: number;
  cp: number;
  [key: string]: number; 
}

export interface HorseRequirements {
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

export type WorkLevel = 'minimum' | 'average' | 'high' | 'light' | 'moderate' | 'heavy' | 'very_heavy';

// البنية الأساسية
export  interface BaseParams {
  ageInMonths: number;
  work: WorkLevel;
}

// 1. الذكور: لديهم isBreeding فقط
export interface MaleParams extends BaseParams {
  sex: 'male';
  isBreeding: boolean;
  pregnantMonth?: never;
  lactatingMonth?: never;
}

// 2. الإناث: لديهم حمل أو رضاعة
export interface FemaleParams extends BaseParams {
  sex: 'female';
  isBreeding?: never; // ممنوع تحديد الـ breed للإناث
  pregnantMonth?: number; // 1-11
  lactatingMonth?: number; // 1-6
}

// 3. الخصيان: لا شيء خاص
export interface GeldingParams extends BaseParams {
  sex: 'gelding';
  isBreeding?: never;
  pregnantMonth?: never;
  lactatingMonth?: never;
}
// type HorseParams = MaleHorse | FemaleHorse | GeldingHorse;
export type HorseInput = MaleParams | FemaleParams | GeldingParams;