exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  const cscLink = process.env.CSC_LINK;

  if (!cscLink) {
    console.log("Skipping notarization — no CSC_LINK (unsigned build).");
    return;
  }

  if (!appleId || !appleIdPassword || !teamId) {
    console.log("Skipping notarization — missing APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID.");
    return;
  }

  let notarize;
  try {
    notarize = require("@electron/notarize").notarize;
  } catch {
    console.log("Skipping notarization — @electron/notarize not installed.");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  console.log(`Notarizing ${appPath}...`);

  await notarize({
    appBundleId: "com.casperrequests.dj-bridge",
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });

  console.log("Notarization complete.");
};
