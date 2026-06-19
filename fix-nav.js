const fs = require('fs');
const file = 'components/bottom-navigation.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
/const navItems = \[[\s\S]*?\]/m,
`const navItems = [
    {
      href: "/dashboard",
      label: t("home", "Home"),
      icon: Home,
    },
    {
      href: "/dashboard/leaderboard",
      label: t("leaderboard", "Ranks"),
      icon: null,
    },
    {
      href: "/dashboard/tasks",
      label: t("missions", "Missions"),
      icon: Flag,
    },
    {
      href: "/dashboard/referrals",
      label: t("friends", "Friends"),
      icon: Users,
    },
    {
      href: "/dashboard/profile",
      label: "",
      icon: null,
    },
  ]`
);

code = code.replace(
/\} else if \(href === "\/dashboard\/tasks"\) \{/g,
`} else if (href === "/dashboard/leaderboard") {
                    return <img src="/images/Stickers/trophy.webp" className={\`w-6 h-6 transition-opacity duration-200 \${isActive ? "opacity-100" : "opacity-40"}\`} alt="Leaderboard" />
                  } else if (href === "/dashboard/tasks") {`
);

code = code.replace(
/ href === "\/dashboard\/referrals" \?\s*\([\s\S]*?\) : href === "\/dashboard\/tasks"/m,
` href === "/dashboard/leaderboard" ? (
                    <img src="/images/Stickers/trophy.webp" className={\`w-6 h-6 object-contain transition-opacity duration-200 \${isActive ? "opacity-100" : "opacity-40"}\`} alt="Leaderboard" />
                  ) : href === "/dashboard/referrals" ? (
                    <AnimatedIcon src="/images/Icons/Friendsem.webp" playCount={playCounts[href] || 0} className={\`w-6 h-6 transition-opacity duration-200 \${isActive ? "opacity-100" : "opacity-40"}\`} />
                  ) : href === "/dashboard/tasks"`
);

// Tweak grid columns from 4 to 5 to fit the new NavItem
code = code.replace(/grid-cols-4/, 'grid-cols-5');
// adjust highlight width from 25% to 20%
code = code.replace(/width: "25%"/, 'width: "20%"');

fs.writeFileSync(file, code);
