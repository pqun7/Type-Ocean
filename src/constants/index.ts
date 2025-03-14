import {
  benefitIcon1,
  benefitIcon2,
  benefitIcon3,
  benefitIcon4,
  benefitIcon5,
  benefitIcon6,
  benefitIcon7,
  benefitIcon8,
  benefitIcon9,
  benefitIcon10,
  file02,
  homeSmile,
  plusSquare,
  searchMd,
  yourlogo,
  gmail,
  github,
  twitter,
  linkedin,
  reddit,
} from "@/assets";

import { StaticImageData } from "next/image";

type NavigationItem = {
  id: string;
  title: string;
  url: string;
  onlyMobile?: boolean;
  isLoggedIn?: boolean;
};

export const navigation: NavigationItem[] = [
  { id: "0", title: "Home", url: "#home" },
  { id: "1", title: "Exercises", url: "#exercises" },
  { id: "2", title: "Leaderboard", url: "#leaderboard" },
  {
    id: "3",
    title: "Sign Up",
    url: "#signup",
    onlyMobile: true,
    isLoggedIn: false,
  },
  {
    id: "4",
    title: "Log In",
    url: "#login",
    onlyMobile: true,
    isLoggedIn: false,
  },
];

export const heroIcons: string[] = [homeSmile, file02, searchMd, plusSquare];

export const companyLogos: string[] = [
  yourlogo,
  yourlogo,
  yourlogo,
  yourlogo,
  yourlogo,
];

type PricingPlan = {
  id: string;
  title: string;
  description: string;
  price: string | null;
  features: string[];
  duration?: string;
};

export const pricing: PricingPlan[] = [
  {
    id: "0",
    title: "Trial",
    description: "Access all sections for a limited time",
    price: "0",
    features: [
      "Full access to all sections for a limited period",
      "Explore premium features before purchasing",
      "No long-term commitment required",
    ],
    duration: "3 days", 
  },
  {
    id: "1",
    title: "Subscription",
    description: "Unlimited access to all sections for a specific period",
    price: "9.99/month",
    features: [
      "Unlimited access to all sections",
      "Regular updates and new features",
      "Priority support",
    ],
    duration: "1 month",
  },
  {
    id: "2",
    title: "Lifetime Section Access",
    description: "Purchase a specific section permanently",
    price: "4.99 per section",
    features: [
      "Lifetime access to the purchased section",
      "No recurring fees",
      "Access updates only for the section",
    ],
  },
];


export const benefits: {
  title: string;
  icon: StaticImageData;
  text: string;
  width?: number;
}[] = [
  {
    title: "Custom Lessons",
    icon: benefitIcon5,
    text: "Create personalized typing lessons tailored to your skill level and goals.",
  },
  {
    title: "Play Games",
    icon: benefitIcon3,
    text: "Challenge yourself with typing games and track your progress over time.",
  },
  {
    title: "Track Progress",
    icon: benefitIcon6,
    text: "Monitor your typing speed and accuracy over time to see how you're improving.",
  },
  {
    title: "Compete with Friends",
    icon: benefitIcon1,
    text: "Join multiplayer typing battles and climb the leaderboards with your friends.",
  },
  {
    title: "Earn Badges",
    icon: benefitIcon8,
    width: 80,
    text: "Unlock achievements and collect rewards as you master different typing skills.",
  },
  {
    title: "Level up",
    icon: benefitIcon10,
    width: 80,
    text: "Improve your typing speed and accuracy with fun and engaging exercises.",
  },
];

export const socials: {
  id: number;
  title: string;
  icon: StaticImageData;
  iconUrl: string;
}[] = [
  {
    id: 1,
    title: "Gmail",
    icon: gmail,
    iconUrl: "mailto:alinazer30@gmail.com",
  },
  {
    id: 2,
    title: "Reddit",
    icon: reddit,
    iconUrl: "https://www.reddit.com/user/Aromatic_House_8586/",
  },
  {
    id: 3,
    title: "Twitter",
    icon: twitter,
    iconUrl: "https://twitter.com/_pqun",
  },
  {
    id: 4,
    title: "LinkedIn",
    icon: linkedin,
    iconUrl: "https://www.linkedin.com/in/pqun/",
  },
  { id: 5, title: "GitHub", icon: github, iconUrl: "https://github.com/pqun7" },
];
