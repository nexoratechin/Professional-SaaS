/**
 * Layout stylesheet for the authenticated staff shell. Scoped under `.app-*` so it never collides
 * with the portal/parent/faculty shells (`.sp-*`, `.pwa-*`) or page-injected styles.
 */
export const APP_SHELL_CSS = `
.app-shell { display: flex; min-height: 100vh; background: var(--ui-color-bg); }

.app-sidebar {
  position: fixed; top: 0; bottom: 0; left: 0; width: 264px; z-index: 60;
  display: flex; flex-direction: column;
  background: var(--ui-color-sidebar); color: #e2e8f0;
  transition: transform .2s ease;
}
.app-sidebar__brand {
  display: flex; align-items: center; gap: 10px; padding: 15px 18px; color: #fff;
  border-bottom: 1px solid rgba(148, 163, 184, .16); text-decoration: none; font-weight: 700;
}
.app-sidebar__brand:hover { text-decoration: none; }
.app-sidebar__brand small { display: block; font-weight: 500; color: var(--ui-color-sidebar-muted); font-size: .72rem; }
.app-sidebar__logo {
  width: 30px; height: 30px; border-radius: 8px; background: var(--ui-color-primary);
  display: inline-flex; align-items: center; justify-content: center; color: #fff; flex: 0 0 auto;
}
.app-sidebar__logoimg { max-width: 34px; max-height: 34px; flex: 0 0 auto; border-radius: 6px; }
.app-sidebar__nav { flex: 1; overflow-y: auto; padding: 12px 10px; }
.app-navgroup { margin-bottom: 12px; }
.app-navgroup__label {
  padding: 8px 12px 4px; font-size: .66rem; font-weight: 700; letter-spacing: .09em;
  text-transform: uppercase; color: var(--ui-color-sidebar-muted);
}
.app-navlink {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px; margin: 1px 0;
  border-radius: 8px; color: #cbd5e1; text-decoration: none; font-size: .87rem; font-weight: 500;
}
.app-navlink:hover { background: rgba(148, 163, 184, .14); color: #fff; text-decoration: none; }
.app-navlink.app-active { background: var(--ui-color-primary); color: #fff; }
.app-navlink svg { flex: 0 0 auto; }
.app-sidebar__foot { padding: 12px; border-top: 1px solid rgba(148, 163, 184, .16); }

.app-main { flex: 1; min-width: 0; margin-left: 264px; display: flex; flex-direction: column; }

.app-topbar {
  position: sticky; top: 0; z-index: 50; height: var(--ui-header-h);
  display: flex; align-items: center; gap: 12px; padding: 0 16px;
  background: var(--ui-color-surface); border-bottom: 1px solid var(--ui-color-border);
}
.app-topbar__menu { display: none; }
.app-breadcrumbs { flex: 1; min-width: 0; overflow: hidden; }
.app-topbar__actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }

.app-searchbtn {
  display: inline-flex; align-items: center; gap: 8px; min-width: 210px;
  border: 1px solid var(--ui-color-border-strong); background: var(--ui-color-surface);
  color: var(--ui-color-text-muted); border-radius: var(--ui-radius-pill);
  padding: 7px 14px; font-size: .82rem; cursor: pointer;
}
.app-searchbtn:hover { border-color: var(--ui-color-text-subtle); color: var(--ui-color-text); }
.app-searchbtn kbd {
  margin-left: auto; font-size: .7rem; border: 1px solid var(--ui-color-border);
  border-radius: 5px; padding: 1px 5px; color: var(--ui-color-text-subtle);
}

.app-iconbtn {
  display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px;
  border: 1px solid var(--ui-color-border); border-radius: var(--ui-radius-md);
  background: var(--ui-color-surface); color: var(--ui-color-text-muted); cursor: pointer;
}
.app-iconbtn:hover { background: var(--ui-color-surface-muted); color: var(--ui-color-text); }

.app-user { position: relative; }
.app-user__btn {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
  background: transparent; border: 1px solid transparent; border-radius: var(--ui-radius-pill);
  padding: 4px 10px 4px 4px;
}
.app-user__btn:hover { background: var(--ui-color-surface-muted); }
.app-user__name { font-size: .85rem; font-weight: 600; color: var(--ui-color-text); }
.app-avatar {
  width: 30px; height: 30px; border-radius: 50%; background: var(--ui-color-primary);
  color: #fff; display: inline-flex; align-items: center; justify-content: center;
  font-size: .76rem; font-weight: 700; flex: 0 0 auto;
}
.app-menu {
  position: absolute; right: 0; top: calc(100% + 8px); min-width: 230px; z-index: 70;
  background: var(--ui-color-surface); border: 1px solid var(--ui-color-border);
  border-radius: var(--ui-radius-md); box-shadow: var(--ui-shadow-md); padding: 6px;
}
.app-menu__head { padding: 8px 10px; border-bottom: 1px solid var(--ui-color-border); margin-bottom: 6px; }
.app-menu__head strong { display: block; font-size: .85rem; }
.app-menu__head span { font-size: .75rem; color: var(--ui-color-text-muted); }
.app-menu button {
  width: 100%; display: flex; align-items: center; gap: 8px; text-align: left;
  background: transparent; border: 0; padding: 9px 10px; border-radius: var(--ui-radius-sm);
  cursor: pointer; font-size: .88rem; color: var(--ui-color-text);
}
.app-menu button:hover { background: var(--ui-color-surface-muted); }

.app-content { padding: 24px 18px 44px; }
.app-content__inner { max-width: 1240px; margin: 0 auto; width: 100%; }

.app-backdrop { display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, .5); z-index: 55; }

@media (max-width: 1024px) {
  .app-sidebar { transform: translateX(-100%); box-shadow: var(--ui-shadow-lg); }
  .app-sidebar.app-open { transform: none; }
  .app-main { margin-left: 0; }
  .app-topbar__menu { display: inline-flex; }
  .app-backdrop.app-open { display: block; }
  .app-searchbtn { min-width: 0; }
  .app-searchbtn .app-searchbtn__label { display: none; }
}
@media (max-width: 640px) {
  .app-content { padding: 16px 12px 32px; }
  .app-searchbtn { display: none; }
  .app-user__name { display: none; }
}
`;
