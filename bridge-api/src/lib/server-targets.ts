import { join } from "path";

export type SiteServerFields = {
  slug: string;
  site_dir?: string;
  server_id?: string;
  server_host?: string;
  server_user?: string;
  server_key_path?: string;
  server_site_root?: string;
  server_repo_root?: string;
  server_credentials_path?: string;
  server_config_path?: string;
};

export type ServerTarget = {
  id: string;
  mode: "local" | "ssh";
  host?: string;
  user?: string;
  keyPath?: string;
  siteRoot: string;
  repoRoot: string;
  credentialsPath: string;
  configPath: string;
};

function buildPrimaryTarget(): ServerTarget {
  const repoRoot = process.env.PRIMARY_SERVER_REPO_ROOT || "/home/ubuntu/wp-bulk-generator";

  return {
    id: process.env.PRIMARY_SERVER_ID || "primary",
    mode: "local",
    host: process.env.PRIMARY_SERVER_HOST || "",
    user: process.env.PRIMARY_SERVER_USER || "ubuntu",
    keyPath: process.env.PRIMARY_SERVER_KEY_PATH || "",
    siteRoot: process.env.PRIMARY_SERVER_SITE_ROOT || process.env.WP_SITES_ROOT || "/var/www",
    repoRoot,
    credentialsPath:
      process.env.PRIMARY_SERVER_CREDENTIALS_PATH ||
      process.env.CREDENTIALS_PATH ||
      join(repoRoot, "bridge-api", "data", "wp-sites-credentials.json"),
    configPath:
      process.env.PRIMARY_SERVER_CONFIG_PATH ||
      process.env.CONFIG_PATH ||
      join(repoRoot, "bridge-api", "data", "wp-sites-config.json"),
  };
}

function buildSecondaryTarget(): ServerTarget | null {
  const host = process.env.SECONDARY_SERVER_HOST || "";
  if (!host) {
    return null;
  }

  const user = process.env.SECONDARY_SERVER_USER || "junguyehong";
  const repoRoot =
    process.env.SECONDARY_SERVER_REPO_ROOT || `/home/${user}/wp-bulk-generator`;

  return {
    id: process.env.SECONDARY_SERVER_ID || "secondary",
    mode: "ssh",
    host,
    user,
    keyPath: process.env.SECONDARY_SERVER_KEY_PATH || "",
    siteRoot: process.env.SECONDARY_SERVER_SITE_ROOT || "/var/www",
    repoRoot,
    credentialsPath:
      process.env.SECONDARY_SERVER_CREDENTIALS_PATH ||
      join(repoRoot, "bridge-api", "data", "wp-sites-credentials.json"),
    configPath:
      process.env.SECONDARY_SERVER_CONFIG_PATH ||
      join(repoRoot, "bridge-api", "data", "wp-sites-config.json"),
  };
}

export function getPrimaryServerTarget(): ServerTarget {
  return buildPrimaryTarget();
}

export function getSecondaryServerTarget(): ServerTarget | null {
  return buildSecondaryTarget();
}

export function getDefaultDeployTarget(): ServerTarget {
  const preferredId = (process.env.DEFAULT_DEPLOY_SERVER_ID || "primary").trim();
  const secondary = buildSecondaryTarget();
  if (secondary && preferredId === secondary.id) {
    return secondary;
  }
  return buildPrimaryTarget();
}

export function resolveSiteTarget(site: SiteServerFields): ServerTarget {
  const primary = buildPrimaryTarget();
  const secondary = buildSecondaryTarget();

  const requestedId = (site.server_id || "").trim();
  if (secondary && requestedId && requestedId === secondary.id) {
    return {
      ...secondary,
      host: site.server_host || secondary.host,
      user: site.server_user || secondary.user,
      keyPath: site.server_key_path || secondary.keyPath,
      siteRoot: site.server_site_root || secondary.siteRoot,
      repoRoot: site.server_repo_root || secondary.repoRoot,
      credentialsPath: site.server_credentials_path || secondary.credentialsPath,
      configPath: site.server_config_path || secondary.configPath,
    };
  }

  if (site.server_host) {
    const secondaryHost = secondary?.host || "";
    const isPrimaryHost =
      !site.server_host ||
      site.server_host === "127.0.0.1" ||
      site.server_host === "localhost" ||
      (primary.host && site.server_host === primary.host);

    if (!isPrimaryHost && site.server_host === secondaryHost && secondary) {
      return {
        ...secondary,
        host: site.server_host,
        user: site.server_user || secondary.user,
        keyPath: site.server_key_path || secondary.keyPath,
        siteRoot: site.server_site_root || secondary.siteRoot,
        repoRoot: site.server_repo_root || secondary.repoRoot,
        credentialsPath: site.server_credentials_path || secondary.credentialsPath,
        configPath: site.server_config_path || secondary.configPath,
      };
    }

    if (!isPrimaryHost) {
      return {
        id: requestedId || "remote",
        mode: "ssh",
        host: site.server_host,
        user: site.server_user || secondary?.user || "ubuntu",
        keyPath: site.server_key_path || secondary?.keyPath || "",
        siteRoot: site.server_site_root || secondary?.siteRoot || "/var/www",
        repoRoot:
          site.server_repo_root ||
          secondary?.repoRoot ||
          `/home/${site.server_user || secondary?.user || "ubuntu"}/wp-bulk-generator`,
        credentialsPath:
          site.server_credentials_path ||
          secondary?.credentialsPath ||
          join(
            site.server_repo_root ||
              secondary?.repoRoot ||
              `/home/${site.server_user || secondary?.user || "ubuntu"}/wp-bulk-generator`,
            "bridge-api",
            "data",
            "wp-sites-credentials.json"
          ),
        configPath:
          site.server_config_path ||
          secondary?.configPath ||
          join(
            site.server_repo_root ||
              secondary?.repoRoot ||
              `/home/${site.server_user || secondary?.user || "ubuntu"}/wp-bulk-generator`,
            "bridge-api",
            "data",
            "wp-sites-config.json"
          ),
      };
    }
  }

  return {
    ...primary,
    host: site.server_host || primary.host,
    user: site.server_user || primary.user,
    keyPath: site.server_key_path || primary.keyPath,
    siteRoot: site.server_site_root || primary.siteRoot,
    repoRoot: site.server_repo_root || primary.repoRoot,
    credentialsPath: site.server_credentials_path || primary.credentialsPath,
    configPath: site.server_config_path || primary.configPath,
  };
}

export function isRemoteTarget(target: ServerTarget): boolean {
  return target.mode === "ssh";
}

export function getSiteDirForTarget(
  site: Pick<SiteServerFields, "slug" | "site_dir" | "server_site_root">,
  target: ServerTarget
): string {
  return site.site_dir || join(site.server_site_root || target.siteRoot, site.slug);
}
