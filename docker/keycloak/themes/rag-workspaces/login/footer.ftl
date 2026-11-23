<#-- keycloak.v2's extension point for a footer under the form: the admin UI's "No account?" note. -->
<#macro content>
<#if !(realm.registrationAllowed!false)>
<div class="rw-note">${msg("rwNoAccount")}</div>
</#if>
</#macro>
