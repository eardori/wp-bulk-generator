const d = require('/tmp/score_result.json');
const lines = [];
lines.push('TOTAL_SCORE=' + d.totalScore);
lines.push('GRADE=' + d.grade);
lines.push('HAS_WEBSITE=' + d.hasWebsite);
lines.push('WEBSITE_URL=' + d.websiteUrl);
lines.push('CRAWL_FAILED=' + d.crawlFailed);
lines.push('CRAWL_ERROR=' + (d.crawlError || 'none'));
lines.push('--- DISCOVERY SOURCES ---');
if (d.discoveredSources) {
  d.discoveredSources.forEach(s => lines.push('  ' + s));
}
lines.push('--- CATEGORIES ---');
d.categories.forEach(c => {
  lines.push(c.score + '/' + c.maxScore + ' ' + c.label);
  c.items.forEach(i => {
    lines.push('  ' + i.status + ' ' + i.actualScore + '/' + i.maxScore + ' ' + i.name + ' | ' + i.recommendation.substring(0, 80));
  });
});
require('fs').writeFileSync('/tmp/score_detail2.txt', lines.join('\n'), 'utf8');
console.log('Done');
