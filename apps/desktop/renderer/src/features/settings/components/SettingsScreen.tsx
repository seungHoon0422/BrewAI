// 설정 — 계정(닉네임 · 비밀번호 · Google) · 테마(시스템 따름) · 기본 모델(허용된 모델만) · 앱 정보
import { providerLabel } from '@brewai/ui';
import { AccountSection } from '../../account/components/AccountSection';
import { ModelName } from '../../models/components/ModelName';
import { reasoningLabel } from '../../models/copy';
import { effectiveModel, effectiveReasoning, useModelState } from '../../models/hooks';
import { Page, Row, Section } from '../../shell/components/Page';
import { SETTINGS } from '../copy';
import { runtimeLabel, useIsDark } from '../hooks';

export function SettingsScreen() {
  const isDark = useIsDark();
  const model = useModelState(effectiveModel);
  const reasoning = useModelState(effectiveReasoning);
  const models = useModelState((s) => s.models.status);
  return (
    <Page id="settings" sub={SETTINGS.sub}>
      <AccountSection />
      <Section title={SETTINGS.general}>
        <ul className="rows">
          <Row title={SETTINGS.theme} sub={SETTINGS.themeSub}>
            <span className="val">{SETTINGS.themeValue(isDark)}</span>
          </Row>
        </ul>
      </Section>
      <Section title={SETTINGS.model}>
        <ul className="rows">
          <Row title={SETTINGS.currentModel} sub={SETTINGS.currentModelSub}>
            {model ? (
              <span className="val mval" title={`${providerLabel(model.provider, model.provider_label)} · ${model.id}`}>
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
      <Section title={SETTINGS.about}>
        <ul className="rows">
          <Row title={SETTINGS.version}><span className="val ui-num">{__APP_VERSION__}</span></Row>
          <Row title={SETTINGS.runtime}><span className="val">{runtimeLabel()}</span></Row>
        </ul>
      </Section>
    </Page>
  );
}
