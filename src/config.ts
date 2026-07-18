import type {
	ExpressiveCodeConfig,
	LicenseConfig,
	NavBarConfig,
	ProfileConfig,
	SiteConfig,
} from "./types/config";
import { LinkPreset } from "./types/config";

export const siteConfig: SiteConfig = {
	title: "0xninho",
	subtitle: "Pentesting & Offensive Security",
	lang: "en",
	themeColor: {
		hue: 200,
		fixed: false,
	},
	banner: {
		enable: false,
		src: "assets/images/demo-banner.png",
		position: "center",
		credit: {
			enable: false,
			text: "",
			url: "",
		},
	},
	toc: {
		enable: true,
		depth: 2,
	},
	favicon: [],
};

export const navBarConfig: NavBarConfig = {
	links: [
		LinkPreset.Home,
		LinkPreset.Archive,
		LinkPreset.About,
		{
			name: "Certifications",
			url: "/certifications/",
			external: false,
		},
		{
			name: "Writeups",
			url: "/archive/?category=Writeups",
			external: false,
		},
		{
			name: "GitHub",
			url: "https://github.com/abdellatiftazarni",
			external: true,
		},
	],
};

export const profileConfig: ProfileConfig = {
	avatar: "/assets/images/profile.jpeg",
	name: "Abdellatif Tazarni",
	bio: "Pentester · CTF Player · HTB Pro Hacker — eCPPT | CRTA",
	links: [
		{
			name: "LinkedIn",
			icon: "fa6-brands:linkedin",
			url: "https://linkedin.com/in/abdellatif-tazarni",
		},
		{
			name: "GitHub",
			icon: "fa6-brands:github",
			url: "https://github.com/abdellatiftazarni",
		},
		{
			name: "HackTheBox",
			icon: "fa6-solid:cube",
			url: "https://app.hackthebox.com/users/2244256",
		},
		{
			name: "APT212",
			icon: "fa6-solid:users",
			url: "https://bio.site/apt212",
		},
		{
			name: "Email",
			icon: "fa6-solid:envelope",
			url: "mailto:abdellatiftazarni@gmail.com",
		},
	],
};

export const licenseConfig: LicenseConfig = {
	enable: false,
	name: "CC BY-NC-SA 4.0",
	url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
	theme: "github-dark",
};
