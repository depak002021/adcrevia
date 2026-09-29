export default function SettingsPage() {
  return (
    <main className="studio-page narrow-page">
      <header className="studio-header"><div><p className="eyebrow">Personal workspace</p><h1>Settings</h1><p>Manage the profile used across your Adcrevia studio.</p></div></header>
      <section className="settings-card">
        <div><h2>Profile</h2><p>Your public studio identity and sign-in address.</p></div>
        <form className="settings-form"><label htmlFor="display-name">Display name</label><input id="display-name" name="name" placeholder="Your name" /><label htmlFor="profile-email">Email address</label><input id="profile-email" type="email" disabled placeholder="Signed-in email" /><button type="button" className="primary-button">Save profile</button></form>
      </section>
      <section className="settings-card"><div><h2>Sessions</h2><p>Sign out of this browser when you finish working.</p></div><button type="button" className="secondary-button">Sign out</button></section>
    </main>
  )
}
