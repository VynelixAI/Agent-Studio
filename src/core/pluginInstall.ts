import {
  getPlugin,
  PLUGIN_STORAGE_KEY,
  type PluginDef,
} from "@/core/pluginCatalog";
import {
  customPluginNodes,
  getPluginCapability,
} from "@/core/pluginNodeCatalog";
import { api } from "@/lib/api";

export const PLUGINS_CHANGED_EVENT = "vynelix-plugins-changed";

export function notifyPluginsChanged() {
  window.dispatchEvent(new Event(PLUGINS_CHANGED_EVENT));
}

export function readInstalledPluginIds(): string[] {
  try {
    const raw = localStorage.getItem(PLUGIN_STORAGE_KEY);
    if (!raw) return ["mongodb"];
    const ids = JSON.parse(raw) as string[];
    return Array.isArray(ids) && ids.length ? ids : ["mongodb"];
  } catch {
    return ["mongodb"];
  }
}

export function writeInstalledPluginIds(ids: string[]) {
  localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(ids));
  notifyPluginsChanged();
}

export function nodesForPlugin(plugin: PluginDef) {
  const cap = getPluginCapability(plugin.id);
  if (cap) return cap.nodes;
  return customPluginNodes(plugin.id, plugin.connectorType);
}

export async function installPluginPackage(plugin: PluginDef): Promise<{
  localPath?: string;
  nodesUnlocked: string[];
  offline?: boolean;
}> {
  const nodes = nodesForPlugin(plugin).map((n) => ({
    type: n.type,
    label: n.label,
    description: n.description,
    kind: n.kind,
  }));

  const ids = readInstalledPluginIds();
  if (!ids.includes(plugin.id)) {
    writeInstalledPluginIds([...ids, plugin.id]);
  } else {
    notifyPluginsChanged();
  }

  try {
    const result = await api.installPlugin({
      pluginId: plugin.id,
      name: plugin.name,
      vendor: plugin.vendor,
      category: plugin.category,
      connectorType: plugin.connectorType,
      accent: plugin.accent,
      badge: plugin.badge,
      description: plugin.description,
      nodes,
      configKeys: plugin.fields.map((f) => f.key),
    });
    return {
      localPath: result.localPath,
      nodesUnlocked: result.nodesUnlocked,
    };
  } catch {
    // UI still unlocks nodes even if API is down (palette works offline)
    return {
      nodesUnlocked: nodes.map((n) => n.type),
      offline: true,
    };
  }
}

export async function uninstallPluginPackage(pluginId: string): Promise<void> {
  writeInstalledPluginIds(
    readInstalledPluginIds().filter((id) => id !== pluginId),
  );
  try {
    await api.uninstallPlugin(pluginId);
  } catch {
    /* offline ok */
  }
}

export function ensurePluginKnown(pluginId: string): PluginDef | undefined {
  return getPlugin(pluginId);
}
