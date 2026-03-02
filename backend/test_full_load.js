// Simulate what happens when unified-gallery loads videos
// This tests all the API calls that get made for each video

const performers = [
  { name: 'meriol_chan', broken: true },
  { name: 'kennedyjaye', broken: true },
  { name: 'Senya Hardin', broken: true },
  { name: 'daddysgirl222', broken: false },
];

const basePath = 'Z:\\Apps\\adultManager\\media';

async function testPerformerLoad(performer) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${performer.name} (${performer.broken ? 'BROKEN' : 'WORKING'})`);
  console.log(`${'='.repeat(60)}`);
  
  const baseUrl = 'http://localhost:4069';
  
  // 1. Get gallery data
  console.log('\n1. Fetching gallery data...');
  const startGallery = Date.now();
  try {
    const galleryUrl = `${baseUrl}/api/gallery/performer-name/${encodeURIComponent(performer.name)}?basePath=${encodeURIComponent(basePath)}`;
    const galleryRes = await fetch(galleryUrl);
    const galleryData = await galleryRes.json();
    console.log(`   ✅ Gallery loaded in ${Date.now() - startGallery}ms`);
    console.log(`   Videos: ${galleryData.vids?.length || 0}`);
    
    if (!galleryData.vids || galleryData.vids.length === 0) {
      console.log('   No videos to test');
      return;
    }
    
    // 2. Test thumbnail fetch for first video
    const firstVid = galleryData.vids[0];
    console.log(`\n2. Testing thumbnail for: ${firstVid.name}`);
    
    // Extract path from URL
    const thumbnailUrl = firstVid.thumbnail || `/api/files/video-thumbnail?path=${encodeURIComponent(firstVid.filePath)}`;
    const fullThumbUrl = `${baseUrl}${thumbnailUrl}`;
    
    const startThumb = Date.now();
    try {
      const thumbRes = await fetch(fullThumbUrl);
      if (thumbRes.ok) {
        const blob = await thumbRes.blob();
        console.log(`   ✅ Thumbnail loaded in ${Date.now() - startThumb}ms, size: ${blob.size} bytes`);
      } else {
        console.log(`   ❌ Thumbnail failed: ${thumbRes.status} ${thumbRes.statusText}`);
      }
    } catch (e) {
      console.log(`   ❌ Thumbnail error: ${e.message}`);
    }
    
    // 3. Test funscript API
    console.log(`\n3. Testing funscript API for: ${firstVid.name}`);
    const funscriptUrl = `${baseUrl}/api/funscripts?file=${encodeURIComponent(firstVid.filePath)}`;
    
    const startFunscript = Date.now();
    try {
      const fsRes = await fetch(funscriptUrl);
      const fsData = await fsRes.json();
      console.log(`   ✅ Funscript API loaded in ${Date.now() - startFunscript}ms`);
      console.log(`   Funscripts found: ${fsData.funscripts?.length || 0}`);
    } catch (e) {
      console.log(`   ❌ Funscript error: ${e.message}`);
    }
    
    // 4. Test scenes API
    console.log(`\n4. Testing scenes API for: ${firstVid.name}`);
    const scenesUrl = `${baseUrl}/api/scenes/video?path=${encodeURIComponent(firstVid.filePath)}`;
    
    const startScenes = Date.now();
    try {
      const scenesRes = await fetch(scenesUrl);
      const scenesData = await scenesRes.json();
      console.log(`   ✅ Scenes API loaded in ${Date.now() - startScenes}ms`);
      console.log(`   Scenes found: ${scenesData.scenes?.length || 0}`);
    } catch (e) {
      console.log(`   ❌ Scenes error: ${e.message}`);
    }
    
  } catch (e) {
    console.log(`   ❌ Gallery error after ${Date.now() - startGallery}ms: ${e.message}`);
  }
}

(async () => {
  for (const performer of performers) {
    await testPerformerLoad(performer);
  }
})();
