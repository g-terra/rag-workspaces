<#-- keycloak.v2's extension point for a footer under the form: the admin UI's "No account?" note, on the
     sign-in pages only (not on OTP, password update or error pages). -->
<#macro content>
<#if ["login", "login-username", "login-password"]?seq_contains(pageId!"") && !(realm.registrationAllowed!false)>
<div class="rw-note">${msg("rwNoAccount")}</div>
</#if>
</#macro>
