import React from "react";
import Image from "next/image";
import Link from "next/link";
import Section from "./Section";
import { socials } from "@/constants";

const Footer = () => {
  return (
    <Section crosses className="!px-0 !py-10">
      <div className="container felx sm:justify-between justify-center items-center gap-10 max-sm:flex-col inline-flex">
        <p className="caption text-n-4 lg:block">
        © {new Date().getFullYear()} Type Ocean. All rights reserved.
        </p>
        <ul className="flex gap-5 flex-wrap">
          {socials.map((item) => (
            <Link key={item.id} href={item.iconUrl} target="_blank" className="flex items-center justify-center w-10 h-10 bg-n-7/30 rounded-full transition-colors hover:bg-n-6">
              <Image src={item.icon} alt={item.title} width={16} height={16} />
            </Link>
          ))}
        </ul>
      </div>
    </Section>
  );
};

export default Footer;
