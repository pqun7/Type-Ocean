"use client";
import { useState, useCallback } from "react";

interface JsonItem {
  [key: string]: any;
}

const WORD_REPLACEMENTS: { [key: string]: string } = {
  // الكلمات الأصلية
  serenity: "peace",
  coveted: "wanted",
  lulling: "calming",
  wondrous: "amazing",
  deception: "lying",
  indigenous: "local",
  deterioration: "decline",

  // إضافات جديدة من الأمثلة
  violence: "fighting",
  quicksand: "traps",
  contrived: "forced",
  ablaze: "burning",
  scourge: "problem",
  pollutants: "harmful stuff",

  paradoxes: "mysteries",
  transcendent: "superior",
  unconditional: "complete",
  posttraumatic: "after-trauma",
  propriety: "proper way",
  falter: "hesitate",
  linger: "stay",
  loiter: "wait",
  analytical: "logical",
  preapocalyptic: "pre-disaster",
  maan: "honor",
  adornd: "decorated",
  venerable: "respected",
  prevaild: "won",
  scoff: "mock",
  punctured: "pierced",
  diplomatic: "polite",
  optimization: "improvement",
  debugging: "fixing errors",
  elegance: "simple beauty",
  premature: "too early",
  partitioned: "divided",
  sequential: "ordered",
  efficiencies: "effectiveness",
  complexity: "complication",
  humility: "modesty",

  kilowatt: "energy unit",
  anthropocentrism: "human focused view",
  subliminal: "hidden message",

  geisha: "traditional artist",

  objectoriented: "structured programming",

  unmotivated: "lacking drive",
  containment: "restriction",
  negation: "denial",

  interface: "surface",
  encryption: "coding",
  bandwidth: "capacity",
  framework: "structure",
  thermodynamics: "heat movement",
  catalyst: "helper",
  mutation: "change",
  radiation: "energy waves",
};

export default function TextProcessor(): React.ReactElement {
  const [processedData, setProcessedData] = useState<JsonItem[]>([]);
  const [status, setStatus] = useState("قم بتحميل ملف JSON لبدء المعالجة");

  // تحسين الأداء باستخدام useCallback
  const replaceComplexWord = useCallback((word: string): string => {
    const normalizedWord = word.toLowerCase().replace(/[^a-z]/g, "");
    const replacement = WORD_REPLACEMENTS[normalizedWord];

    if (replacement) {
      const firstLetter =
        word[0] === word[0].toUpperCase()
          ? replacement[0].toUpperCase()
          : replacement[0].toLowerCase();
      return firstLetter + replacement.slice(1);
    }
    return word;
  }, []);

  const processText = useCallback(
    (text: string): string => {
      return (
        text
          .replace(/,+/g, ",") // تقليل الفواصل المتكررة
          .replace(/\s*,\s*/g, ", ") // توحيد المسافات حول الفواصل
          .replace(/,(\s*)(?=[.,!?])/g, ",") // إزالة المسافة قبل علامات الترقيم
          .replace(/,([^\s])/g, ", $1") // إضافة مسافة بعد الفاصلة إذا ناقصة
          .replace(/,\s*$/, ",") // التعامل مع الفاصلة في نهاية الجملة
          .replace(/,(\s*)(and|or|but)/gi, ', $2')
          .replace(/\s+/g, ' ')
          .replace(/,\s*([.!?])/g, '$1')
          .replace(/(\d),(\d)/g, '$1,$2')


          // التنظيف العام
          .replace(/\([^)]*\)/g, "") // إزالة الأقواس ومحتوياتها
          .replace(/[^\p{L}\p{N}\s,.'’!?]/gu, "")
          .replace(/\s+/g, " ")
          .trim()
          
      );
    },
    [replaceComplexWord]
  );

  const deepProcess = (data: any): any => {
    if (typeof data === "string") return processText(data);
    if (Array.isArray(data)) return data.map(deepProcess);
    if (typeof data === "object" && data !== null) {
      return Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, deepProcess(value)])
      );
    }
    return data;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("جاري المعالجة...");

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const rawData = JSON.parse(event.target?.result as string);
        const processed = deepProcess(rawData);
        setProcessedData(Array.isArray(processed) ? processed : [processed]);
        setStatus("تمت المعالجة بنجاح");
      } catch (err) {
        setStatus("خطأ في تحليل الملف - تأكد من صيغة JSON");
      }
    };
    reader.readAsText(file);
  };

  const downloadJSON = () => {
    const blob = new Blob([JSON.stringify(processedData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "processed-data.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Text Processor</h1>

      <div className="mb-4">
        <input
          type="file"
          accept=".json"
          onChange={handleFileUpload}
          className="block w-full text-sm text-gray-500
            file:mr-4 file:py-2 file:px-4
            file:rounded-full file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700
            hover:file:bg-blue-100"
        />
      </div>

      <p className="mb-4 text-gray-600">{status}</p>

      <button
        onClick={downloadJSON}
        className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300"
        disabled={!processedData.length}
      >
        تنزيل البيانات المعالجة
      </button>
    </div>
  );
}
