/** Camera scale as an integer percentage (100 = 1:1). */
export function zoomPercent(scale: number): number {
  return Math.round(scale * 100);
}
