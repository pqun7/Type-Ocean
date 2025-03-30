"use client";

import { useState } from "react";

interface JsonItem {
  id: number;
  content: string;
  timestamp: string;
}

function TextCategorizer() {
  const [status, setStatus] = useState<string>("Upload JSON file to begin");
  const [categories, setCategories] = useState<{
    short: JsonItem[];
    medium: JsonItem[];
    long: JsonItem[];
  }>({ short: [], medium: [], long: [] });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data: JsonItem[] = JSON.parse(e.target?.result as string);
        processData(data);
        setStatus("File processed successfully!");
      } catch (error) {
        setStatus("Error processing file. Invalid JSON format.");
      }
    };
    reader.readAsText(file);
  };

  const processData = (data: JsonItem[]) => {
    const newCategories = {
      short: [] as JsonItem[],
      medium: [] as JsonItem[],
      long: [] as JsonItem[],
    };

    data.forEach((item) => {
      if (!item.content) return;

      const length = item.content.length;
      if (length >= 50 && length <= 100) {
        newCategories.short.push(item);
      } else if (length >= 101 && length <= 160) {
        newCategories.medium.push(item);
      } else if (length >= 161 && length <= 220) {
        newCategories.long.push(item);
      }
    });

    setCategories(newCategories);
  };

  const downloadJSON = (content: JsonItem[], filename: string) => {
    const blob = new Blob([JSON.stringify(content, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Text Categorizer</h1>

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-blue-50 rounded-lg">
          <h2 className="font-bold mb-2">Short (50-100)</h2>
          <p>Items: {categories.short.length}</p>
          <button
            onClick={() => downloadJSON(categories.short, "short.json")}
            className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300"
            disabled={!categories.short.length}
          >
            Download
          </button>
        </div>

        <div className="p-4 bg-green-50 rounded-lg">
          <h2 className="font-bold mb-2">Medium (101-160)</h2>
          <p>Items: {categories.medium.length}</p>
          <button
            onClick={() => downloadJSON(categories.medium, "medium.json")}
            className="mt-2 bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:bg-gray-300"
            disabled={!categories.medium.length}
          >
            Download
          </button>
        </div>

        <div className="p-4 bg-purple-50 rounded-lg">
          <h2 className="font-bold mb-2">Long (161-220)</h2>
          <p>Items: {categories.long.length}</p>
          <button
            onClick={() => downloadJSON(categories.long, "long.json")}
            className="mt-2 bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600 disabled:bg-gray-300"
            disabled={!categories.long.length}
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}