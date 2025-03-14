interface StatsProps {
    wpm: number;
    accuracy: number;
  }
  
  export default function Stats({ wpm, accuracy }: StatsProps) {
    return (
      <div className="flex justify-between mb-4">
        <div className="text-sm text-gray-100">
          WPM: <span className="font-bold text-blue-500">{wpm}</span>
        </div>
        <div className="text-sm text-gray-100">
          Accuracy: <span className="font-bold text-blue-500">{Math.round(accuracy)}%</span>
        </div>
      </div>
    );
  }
  