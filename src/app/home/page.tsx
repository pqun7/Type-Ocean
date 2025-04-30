// import { NextPage } from "next";
import HeaderGame from "@/components/Typing";
import { NextPage } from "next";

// NOTE: sholde add Alert for email verification
const Home: NextPage = ({}) => {
  return (
    <>
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
        <HeaderGame />
        {/* <DataProcessor/> */}
      </div>
    </>
  );
};

export default Home;
