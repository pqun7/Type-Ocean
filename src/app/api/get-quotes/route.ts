import fs from 'fs';
import path from 'path';

export async function saveQuoteToFile() {
  try {
    const res = await fetch("https://thequoteshub.com/api/random-quote", {
      headers: {
        "Cache-Control": "no-cache",
        "User-Agent": "MyQuoteApp (contact@myapp.com)"
      }
    });

    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      throw new Error('Invalid content type');
    }

    const newData = await res.json();
    const filePath = path.join(process.cwd(), "src/app/api/quotes.json");
    
    let existingData: any[] = [];
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, "utf-8");
        existingData = JSON.parse(fileContent);
      } catch (e) {
        console.error('Error parsing existing data:', e);
      }
    }
    
    if (!Array.isArray(existingData)) existingData = [];
    
    existingData.unshift({
      ...newData,
      timestamp: performance.now().toString()
    });
    
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(existingData, null, 2));
    fs.renameSync(tmpPath, filePath);
    
    console.log(`New quote added to: ${filePath}`);
    console.log(`Total quotes now: ${existingData.length}`);
    
    return true;
  } catch (error) {
    console.error('Error saving quote:', error);
    return false;
  }
}