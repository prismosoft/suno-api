import Link from "next/link";
import Logo from "./Logo";

export default function Header() {
    return (
        <nav className=" flex w-full justify-center py-4 items-center 
        border-b border-gray-300  backdrop-blur-2xl font-mono text-sm px-4 lg:px-0">
            <div className="max-w-3xl flex w-full items-center justify-between">
                <div className="font-medium text-xl text-indigo-900 flex items-center gap-2">
                    <Logo className="w-4 h-4" />
                    <Link href='/'>
                        Suno API
                    </Link>
                </div>
                <div className="flex items-center justify-center gap-1 text-sm font-light text-indigo-900/90">
                    <p className="p-2 lg:px-6 lg:py-3 rounded-full flex justify-center items-center
                lg:hover:bg-indigo-300 duration-200
                ">
                        <Link href="/">
                            Get Started
                        </Link>
                    </p>
                    <p className="p-2 lg:px-6 lg:py-3 rounded-full flex justify-center items-center
                lg:hover:bg-indigo-300 duration-200
                ">
                        <Link href="/docs">
                            API Docs
                        </Link>
                    </p>
                    <p className="p-2 lg:px-6 lg:py-3 rounded-full flex justify-center items-center
                lg:hover:bg-indigo-300 duration-200
                ">
                        <a href="https://github.com/prismosoft/suno-api"
                            target="_blank"
                            className="flex items-center justify-center gap-1">
                            <span className="">
                                <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>
                            </span>
                            <span>Github</span>
                        </a>
                    </p>
                </div>



            </div>
        </nav>
    );
}
