// import { NextPage } from "next";
import HeaderGame  from "@/components/Typing";

import { NextPage } from "next";


const TestText = {
  SHORT: {
    Minimum:
      "Typing fast improves productivity and efficiency, helping users complete tasks quickly and accurately.",
    Maximum:
      "Mastering touch typing allows for faster and more accurate text input, reducing errors and increasing efficiency over time.",
  },
  MEDIUM: {
    Minimum:
      "Fast typing enhances workflow efficiency, minimizes mistakes, and allows users to focus on ideas rather than the mechanics of typing itself.",
    Maximum:
      "Developing strong typing skills improves both speed and accuracy, enabling users to complete tasks efficiently while reducing cognitive load and enhancing overall productivity.",
  },
  LONG: {
    Minimum:
      "Typing quickly and accurately is an essential skill in today’s digital world. It boosts productivity, reduces fatigue, and helps professionals communicate more effectively in various fields, from writing to programming.",
    Maximum:
      "Mastering the skill of fast and accurate typing can significantly enhance workplace efficiency, allowing individuals to complete assignments, respond to emails, and process documents in a fraction of the time. This efficiency ultimately leads to increased focus and better time management.",
  },
};


const Home: NextPage = ({}) => {
  return (
    <>
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
        <HeaderGame />
      </div>
    </>
  );
};

export default Home;
