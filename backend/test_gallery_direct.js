// Test the gallery API directly to see the response

const basePath = 'Z:\\Apps\\adultManager\\media';
const brokenPerformers = ['Senya Hardin', 'kennedyjaye', 'meriol_chan'];
const workingPerformer = 'daddysgirl222';

async function testGallery(name) {
  const url = `http://localhost:4069/api/gallery/performer-name/${encodeURIComponent(name)}?basePath=${encodeURIComponent(basePath)}`;
  console.log(`\n=== Testing ${name} ===`);
  console.log(`URL: ${url}`);
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    console.log(`Status: ${response.status}`);
    console.log(`Pics: ${data.pics?.length || 0}`);
    console.log(`Vids: ${data.vids?.length || 0}`);
    console.log(`FunscriptVids: ${data.funscriptVids?.length || 0}`);
    
    // Check video URLs for issues
    if (data.vids && data.vids.length > 0) {
      console.log(`\nSample video entries:`);
      for (const vid of data.vids.slice(0, 3)) {
        console.log(`  - ${vid.name}`);
        console.log(`    url: ${vid.url?.substring(0, 80)}...`);
        console.log(`    thumbnail: ${vid.thumbnail?.substring(0, 80)}...`);
        
        // Check for any unusual characters
        if (vid.url && /[^\x00-\x7F]/.test(vid.url)) {
          console.log(`    ⚠️ Non-ASCII in URL!`);
        }
        if (vid.name && /[^\x00-\x7F]/.test(vid.name)) {
          console.log(`    ⚠️ Non-ASCII in name!`);
        }
      }
    }
    
    // Check response size
    const responseSize = JSON.stringify(data).length;
    console.log(`\nResponse size: ${(responseSize / 1024).toFixed(1)} KB`);
    
  } catch (e) {
    console.error(`Error: ${e.message}`);
  }
}

(async () => {
  // Test broken performers
  for (const name of brokenPerformers) {
    await testGallery(name);
  }
  
  // Test working performer
  await testGallery(workingPerformer);
})();
