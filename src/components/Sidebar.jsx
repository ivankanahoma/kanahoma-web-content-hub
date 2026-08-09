import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SECTIONS, parentOf } from "../lib/sections";

function NavItem({ section, active, onSelect, collapsed, counts, child, hasActiveChild }) {
  const Icon = section.icon;
  const count = section.countKey ? counts?.[section.countKey] : null;

  return (
    <button
      className={[
        "nav-item",
        child ? "child" : "",
        hasActiveChild ? "has-active-child" : "",
      ].filter(Boolean).join(" ")}
      // The label is hidden while collapsed, so name the button explicitly rather than
      // leaving assistive tech with just an icon.
      aria-label={section.label}
      aria-current={active === section.id ? "page" : undefined}
      onClick={() => onSelect(section.id)}
      title={collapsed ? section.label : undefined}
    >
      <Icon size={child ? 15 : 17} strokeWidth={1.75} />
      <span className="nav-label">{section.label}</span>
      {!section.ready && <span className="nav-soon">soon</span>}
      {section.ready && count != null && <span className="nav-count">{count}</span>}
    </button>
  );
}

export default function Sidebar({ active, onSelect, collapsed, onToggle, counts }) {
  const activeParent = parentOf(active);

  return (
    <nav className={`sidebar ${collapsed ? "collapsed" : ""}`} aria-label="Sections">
      <ul>
        {SECTIONS.map((section) => {
          const showChildren =
            !collapsed && (active === section.id || activeParent === section.id);
          return (
            <li key={section.id}>
              <NavItem
                section={section}
                active={active}
                onSelect={onSelect}
                collapsed={collapsed}
                counts={counts}
                hasActiveChild={activeParent === section.id}
              />
              {section.children && showChildren && (
                <ul className="nav-children">
                  {section.children.map((childSection) => (
                    <li key={childSection.id}>
                      <NavItem
                        child
                        section={childSection}
                        active={active}
                        onSelect={onSelect}
                        collapsed={collapsed}
                        counts={counts}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <button
        className="nav-item collapse-toggle"
        onClick={onToggle}
        aria-label={collapsed ? "Expand menu" : "Collapse menu"}
      >
        {collapsed
          ? <PanelLeftOpen size={17} strokeWidth={1.75} />
          : <PanelLeftClose size={17} strokeWidth={1.75} />}
        <span className="nav-label">Collapse</span>
      </button>
    </nav>
  );
}
