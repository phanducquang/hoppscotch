<template>
  <div class="flex flex-col flex-1 py-4 space-y-4">
    <HoppSmartInput
      v-model="currentConfigs.oidcConfigs.OIDC_DISPLAY_NAME"
      :label="t('onboarding.oidc.display_name')"
      input-styles="floating-input"
      class="!my-2 !bg-primaryLight flex-1"
    />
    <HoppSmartInput
      v-model="currentConfigs.oidcConfigs.OIDC_ISSUER"
      :label="t('onboarding.oidc.issuer')"
      input-styles="floating-input"
      class="!my-2 !bg-primaryLight flex-1"
    />
    <HoppSmartInput
      v-model="currentConfigs.oidcConfigs.OIDC_CLIENT_ID"
      :label="t('onboarding.oidc.client_id')"
      input-styles="floating-input"
      class="!my-2 !bg-primaryLight flex-1"
    />
    <HoppSmartInput
      v-model="currentConfigs.oidcConfigs.OIDC_CLIENT_SECRET"
      :label="t('onboarding.oidc.client_secret')"
      type="password"
      autocomplete="new-password"
      input-styles="floating-input"
      class="!my-2 !bg-primaryLight flex-1"
    />
    <p class="text-secondaryLight text-tiny">
      {{ t('onboarding.oidc.client_secret_description') }}
    </p>
    <HoppSmartInput
      v-model="currentConfigs.oidcConfigs.OIDC_CALLBACK_URL"
      :label="t('onboarding.oidc.callback_url')"
      input-styles="floating-input !border-0"
      class="!my-2 !bg-primaryLight flex-1 rounded border border-divider"
      :disabled="true"
    >
      <template #button>
        <HoppSmartItem
          v-tippy="{ theme: 'tooltip' }"
          :icon="IconCopy"
          :title="t('state.copy')"
          class="hover:bg-transparent"
          @click="copyCallbackUrl"
        />
      </template>
    </HoppSmartInput>
    <HoppSmartInput
      v-model="currentConfigs.oidcConfigs.OIDC_SCOPE"
      :label="t('onboarding.oidc.scopes')"
      input-styles="floating-input"
      class="!my-2 !bg-primaryLight flex-1"
    />
  </div>
</template>

<script lang="ts" setup>
import { useVModel } from '@vueuse/core';
import { useI18n } from '~/composables/i18n';
import { useToast } from '~/composables/toast';
import { Configs } from '~/composables/useOnboardingConfigHandler';
import { copyToClipboard } from '~/helpers/utils/clipboard';
import IconCopy from '~icons/lucide/copy';

const props = defineProps<{
  currentConfigs: Configs;
}>();

const currentConfigs = useVModel(props, 'currentConfigs');
const t = useI18n();
const toast = useToast();

const copyCallbackUrl = () => {
  copyToClipboard(currentConfigs.value.oidcConfigs.OIDC_CALLBACK_URL);
  toast.success(t('state.copied_to_clipboard'));
};
</script>
