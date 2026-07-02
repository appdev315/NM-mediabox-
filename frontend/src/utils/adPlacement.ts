export function shouldShowAd(index: number): boolean {
  // Start showing ads only after the first few items
  if (index < 10) return false;

  // Divide into blocks of 17 items
  const block = Math.floor(index / 17);
  
  // Deterministic pseudo-random offset between 0 and 5 based on block index
  const offset = (block * 13) % 6; 
  
  // The ad will appear at position 12 + offset within the block (so between 12 and 17)
  // Overall interval between ads will be roughly 15-20 items.
  const targetIndex = block * 17 + 12 + offset;
  
  return index === targetIndex;
}
