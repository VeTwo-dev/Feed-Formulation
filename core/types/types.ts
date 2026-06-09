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
