export const REFRESH_PATH_POWERSHELL = '$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User");'
export const FILE_PATH_EMPTY = ''
export const GET_PATH_POWER_SHELL = 'echo ([System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"));'
