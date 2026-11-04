// 설정 화면 — 세부 메뉴(사이드바 SettingsNav)마다 한 화면: 계정 · 일반(테마) · 모델(허용된 모델만) · 앱 정보. 스킬 · 연결된 앱은 각 기능 화면.
import { providerLabel } from '@brewai/ui';
import { AccountSection } from '../../account/components/AccountSection';
import { ModelName } from '../../models/components/ModelName';
import { reasoningLabel } from '../../models/copy';
import { effectiveModel, effectiveReasoning, useModelState } from '../../models/hooks';
import { Page, Row, Section } from '../../shell/components/Page';
import { SETTINGS } from '../copy';
import { runtimeLabel, useIsDark } from '../hooks';

export function AccountScreen() {
  return (
    <Page id="settings/account" sub={SETTINGS.accountSub}>
      <AccountSection />
    </Page>
  );
}

export function GeneralScreen() {
  const isDark = useIsDark();
  return (
    <Page id="settings/general" sub={SETTINGS.generalSub}>
      <Section title={SETTINGS.general}>
        <ul className="rows">
          <Row title={SETTINGS.theme} sub={SETTINGS.themeSub}>
            <span className="val">{SETTINGS.themeValue(isDark)}</span>
          </Row>
        </ul>
      </Section>
    </Page>
  );
}

export function ModelScreen() {
  const model = useModelState(effectiveModel);
  const reasoning = useModelState(effectiveReasoning);
  const models = useModelState((s) => s.models.status);
  return (
    <Page id="settings/model" sub={SETTINGS.modelSub}>
      <Section title={SETTINGS.model}>
        <ul className="rows">
          <Row title={SETTINGS.currentModel} sub={SETTINGS.currentModelSub}>
            {model ? (
              <span className="val mval" title={`${providerLabel(model.provider, model.provider_label)}, ${model.id}`}>
                <ModelName model={model} showId={false} />
              </span>
            ) : (
              <span className="val">{models === 'loading' ? SETTINGS.modelLoading : SETTINGS.modelOffline}</span>
            )}
          </Row>
          <Row title={SETTINGS.depth} sub={SETTINGS.depthSub}>
            <span className="val">{reasoningLabel(reasoning)}</span>
          </Row>
        </ul>
      </Section>
    </Page>
  );
}

export function AboutScreen() {
  return (
    <Page id="settings/about" sub={SETTINGS.aboutSub}>
      <Section title={SETTINGS.about}>
        <ul className="rows">
          <Row title={SETTINGS.version}><span className="val ui-num">{__APP_VERSION__}</span></Row>
          <Row title={SETTINGS.runtime}><span className="val">{runtimeLabel()}</span></Row>
        </ul>
      </Section>
    </Page>
  );
}
