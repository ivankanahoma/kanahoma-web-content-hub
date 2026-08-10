import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { parentOf, sectionsFor } from "../lib/sections";

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

/**
 * A grouping label rather than a destination. It carries no count and no aria-current,
 * because nothing about it can be the current page.
 */
function NavHeading({ section, collapsed }) {
  const Icon = section.icon;
  return (
    <div className="nav-item heading" title={collapsed ? section.label : undefined}>
      <Icon size={17} strokeWidth={1.75} />
      <span className="nav-label">{section.label}</span>
    </div>
  );
}

export default function Sidebar({ active, onSelect, collapsed, onToggle, counts, role }) {
  const activeParent = parentOf(active);
  const sections = sectionsFor(role);

  return (
    <nav className={`sidebar ${collapsed ? "collapsed" : ""}`} aria-label="Sections">
      <ul>
        {sections.map((section) => {
          // A heading cannot be selected, so waiting for it to become active would hide
          // its children forever. Those are always open.
          const showChildren = !collapsed &&
            (section.navigable === false ||
             active === section.id ||
             activeParent === section.id);
          return (
            <li key={section.id}>
              {section.navigable === false ? (
                <NavHeading section={section} collapsed={collapsed} />
              ) : (
                <NavItem
                  section={section}
                  active={active}
                  onSelect={onSelect}
                  collapsed={collapsed}
                  counts={counts}
                  hasActiveChild={activeParent === section.id}
                />
              )}
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
