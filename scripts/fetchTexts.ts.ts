import { prisma } from '../src/lib/db';
import { writeFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const allTexts = await prisma.texts.findMany();
  
  const fileContent = `// Auto-generated file
export const textsData = ${JSON.stringify(allTexts, null, 2)} as const;
`;

  const outputPath = join(process.cwd(), 'dataText.ts');
  writeFileSync(outputPath, fileContent);
  console.log('تم إنشاء الملف بنجاح!');
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());