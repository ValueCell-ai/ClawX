import type { ComponentType } from 'react';
import type { Skill } from '../types/skill';

export interface NavItemDef {
  to: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  labelI18nKey?: string;
  testId?: string;
}

export type I18nResources = Record<string, Record<string, unknown>>;

export interface SidebarExtension {
  id: string;
  navItems?: NavItemDef[];
  hiddenRoutes?: string[];
}

export interface RouteDef {
  path: string;
  component: ComponentType;
}

export interface RouteExtension {
  id: string;
  routes: RouteDef[];
}

export interface SettingsSectionDef {
  id: string;
  component: ComponentType;
  order?: number;
}

export interface SettingsSectionExtension {
  id: string;
  sections: SettingsSectionDef[];
}

export interface SkillDetailMetaProps {
  skill: Skill;
}

export interface SkillsExtension {
  id: string;
  detailMetaComponents?: ComponentType<SkillDetailMetaProps>[];
}

export interface RendererExtension {
  id: string;
  sidebar?: SidebarExtension;
  routes?: RouteExtension;
  settings?: SettingsSectionExtension;
  skills?: SkillsExtension;
  i18nResources?: I18nResources;
  setup?(): void | Promise<void>;
  teardown?(): void;
}
