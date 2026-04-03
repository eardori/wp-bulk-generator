import fs from 'fs';
const p = 'src/routes/score-checker.ts';
const lines = fs.readFileSync(p, 'utf8').split('\n');

// Find the pattern: after "return result;" + "}" there should be orphaned old code
// We need to find line "  return result;" followed by "}" followed by orphaned code
// and remove it up to "async function runDiscovery"

let removeStart = -1;
let removeEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === 'return result;' && i + 1 < lines.length && lines[i+1].trim() === '}') {
    // Check if next lines after "}" have orphaned code
    if (i + 3 < lines.length && !lines[i+2].trim().startsWith('async function') && !lines[i+2].trim().startsWith('function')) {
      let j = i + 2;
      // Find where "async function runDiscovery" starts
      while (j < lines.length && !lines[j].includes('async function runDiscovery')) {
        j++;
      }
      if (j < lines.length) {
        removeStart = i + 2;
        removeEnd = j;
        break;
      }
    }
  }
}

if (removeStart > 0 && removeEnd > removeStart) {
  const result = [...lines.slice(0, removeStart), '', ...lines.slice(removeEnd)];
  fs.writeFileSync(p, result.join('\n'), 'utf8');
  console.log(`Removed lines ${removeStart+1} to ${removeEnd}. ${lines.length} -> ${result.length} lines`);
} else {
  console.log('Pattern not found. removeStart:', removeStart, 'removeEnd:', removeEnd);
}
