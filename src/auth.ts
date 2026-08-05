import * as vscode from 'vscode';

const SERVICE_NAME = 'openGrok';

/**
 * Retrieve saved credentials.
 */
export async function getCookie(context: vscode.ExtensionContext): Promise<string | undefined> {
  const secrets = context.secrets;

  const cookieKey = `${SERVICE_NAME}.cookie`;
  let cookie = await secrets.get(cookieKey);
  
  return cookie;
}

/**
 * Remove saved credentials (e.g. for logout).
 */
async function saveCreds(context: vscode.ExtensionContext, username: string, password: string, cookie: string) {
  const secrets = context.secrets;
  await secrets.store(`${SERVICE_NAME}.cookie`, cookie);
}

/**
 * Remove saved credentials (e.g. for logout).
 */
export async function clearCreds(context: vscode.ExtensionContext) {
  const secrets = context.secrets;
  await secrets.delete(`${SERVICE_NAME}.cookie`);
}

/**
 * Promt user for the credentials and login.
 */
export  async function login(context: vscode.ExtensionContext, serverURL: string) {

  clearCreds(context);

  const username = await vscode.window.showInputBox({
      title: 'OpenGrok',
      prompt: 'Enter your username',
      ignoreFocusOut: true,
    });
  if (!username)
    return false;

  const password = await vscode.window.showInputBox({
      title: 'OpenGrok',
      prompt: 'Enter your password',
      password: true,
      ignoreFocusOut: true,
    });
  if (!password)
    return false;

  try {
    const response = await fetch(`${serverURL}/login`, {
      method: "POST",
      headers: {
          "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
          username,
          password,
      }),
      redirect: "manual",
    });

    if (response.status == 200 || response.status == 302) {
      const setCookie = response.headers.get('set-cookie') ?? '';
      const cookie = setCookie?.split(';')[0] ?? '';
      await saveCreds(context, username, password, cookie);
      vscode.window.showInformationMessage('Authentication succeed.');
      return true;
    } else if (response.status === 401) {
      vscode.window.showErrorMessage('Authentication failed.\n Invalid username or password.');
    } else {
      vscode.window.showErrorMessage(`Authentication request failed, code: ${response.status}`);
    }
  } catch (err: any) {
    console.log(err);
    vscode.window.showErrorMessage(`Authentication request failed: ${err.message}`);
  }

  return false;
}